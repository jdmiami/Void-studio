import { clamp, project } from './effects.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const blend = (a, b, ratio = .52) => a ? {
  x: a.x + (b.x - a.x) * ratio,
  y: a.y + (b.y - a.y) * ratio,
  z: b.z,
} : b;

export class VisionTracker {
  constructor(compositor) {
    this.compositor = compositor;
    this.reset();
    this.nextHandFrame = 0;
    this.nextPoseFrame = 0;
  }

  reset() {
    this.hands = [];
    this.trails = [];
    this.body = null;
    this.circle = [];
    this.portal = null;
    this.maskAvailable = false;
    this.pinch = null;
    this.controlHand = null;
    this.hoverTarget = null;
    this.previousVideoTime = -1;
  }

  async load() {
    if (!this.loading) this.loading = this.loadModels().catch(error => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  async loadModels() {
    const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/vision');
    this.handModel ||= await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/hand.task', delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: .53,
      minHandPresenceConfidence: .55,
      minTrackingConfidence: .55,
    });
    try {
      this.poseModel ||= await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: true,
        minPosePresenceConfidence: .55,
      });
    } catch (error) {
      this.poseError = error;
    }
  }

  update(video, now, settings, capturePose = false) {
    const compositor = this.compositor;
    const fit = compositor.fit;
    if (!this.handModel || !fit || video.readyState < 2 || video.currentTime === this.previousVideoTime) return;
    if (now < this.nextHandFrame && now < this.nextPoseFrame) return;
    this.previousVideoTime = video.currentTime;
    const { width, height } = compositor.canvas;
    const toPreview = point => project(point, fit, width, height);

    if (now >= this.nextHandFrame) {
      this.nextHandFrame = now + 1000 / settings.tracking;
      const { landmarks, handedness } = this.handModel.detectForVideo(video, now);
      const seen = new Set();
      const next = landmarks.map((points, index) => {
        let side = handedness[index]?.[0]?.categoryName || String(index);
        if (seen.has(side)) side += index;
        seen.add(side);
        const previous = this.hands.find(hand => hand.side === side);
        const palm = toPreview(points[9]);
        const fingertip = points[8];
        const scale = Math.max(.035, distance(points[0], points[9]));
        const pinchRatio = distance(fingertip, points[4]) / scale;
        const pointing = distance(fingertip, points[0]) > scale * 1.37
          && [12, 16, 20].every(finger => distance(points[finger], points[0]) < scale * 1.36);
        return {
          side,
          palm: blend(previous?.palm, palm),
          tip: blend(previous?.tip, toPreview(fingertip)),
          pointer: blend(previous?.pointer, { x: fit.mirror ? 1 - fingertip.x : fingertip.x, y: fingertip.y }),
          pinched: pinchRatio < (previous?.pinched ? .45 : .32),
          pointing,
          pinchedOpen: pinchRatio > .55,
        };
      });
      this.hands = next;
      const trailWindow = 1100;
      const updated = this.trails.map(trail => ({ ...trail, points: trail.points.filter(point => now - point.t < trailWindow) }));
      next.forEach(hand => {
        let track = updated.find(item => item.side === hand.side);
        if (!track) {
          track = { side: hand.side, points: [] };
          updated.push(track);
        }
        track.points.push({ ...hand.palm, t: now });
      });
      this.trails = updated.filter(item => item.points.length);
      if (settings.family === 'portal') this.detectCircle(next.find(hand => !hand.pointing)?.palm, now, width / height);
      else this.circle = [];
    }

    const needsPose = settings.depth || settings.family === 'aura' || capturePose;
    if (needsPose && this.poseModel && now >= this.nextPoseFrame) {
      this.nextPoseFrame = now + 1000 / Math.max(4, settings.tracking * .56);
      this.poseModel.detectForVideo(video, now, result => {
        const points = result.landmarks[0];
        this.body = null;
        this.maskAvailable = false;
        if (!points || Math.min(points[11].visibility, points[12].visibility) < .46) return;
        const left = toPreview(points[11]);
        const right = toPreview(points[12]);
        const hipsVisible = Math.min(points[23].visibility, points[24].visibility) > .42;
        const hips = hipsVisible ? (toPreview(points[23]).y + toPreview(points[24]).y) / 2 : (left.y + right.y) / 2 + .29;
        this.body = {
          x: (left.x + right.x) / 2,
          y: (left.y + right.y + hips * 2) / 4,
          scale: Math.min(.7, Math.abs(left.x - right.x) * 1.36 + .1),
          points: settings.skeleton ? points.map(point => point.visibility > .52 ? toPreview(point) : null) : null,
          z: (left.z + right.z) / 2,
        };
        if (settings.depth && result.segmentationMasks?.[0]) {
          compositor.updateMask(result.segmentationMasks[0]);
          this.maskAvailable = true;
        }
      });
    }
    if (!needsPose) this.body = null;
  }

  detectCircle(point, now, aspect) {
    this.circle = this.circle.filter(sample => now - sample.t < 1550);
    if (!point || (this.portal && now - this.portal.born < 800)) return;
    if (this.circle.length && distance(this.circle.at(-1), point) < .013) return;
    this.circle.push({ ...point, t: now });
    const path = this.circle;
    if (path.length < 9 || now - path[0].t < 380) return;
    const first = path[0];
    if (distance(point, first) > .11) return;
    const center = path.reduce((a, sample) => ({ x: a.x + sample.x / path.length, y: a.y + sample.y / path.length }), { x: 0, y: 0 });
    const radii = path.map(sample => Math.hypot((sample.x - center.x) * aspect, sample.y - center.y));
    const radius = radii.reduce((sum, value) => sum + value, 0) / path.length;
    if (radius < .046 || Math.min(...radii) < radius * .4 || Math.max(...radii) > radius * 1.85) return;
    const angles = path.map(sample => Math.atan2(sample.y - center.y, (sample.x - center.x) * aspect));
    let winding = 0;
    for (let index = 1; index < angles.length; index++) {
      const delta = angles[index] - angles[index - 1];
      winding += Math.atan2(Math.sin(delta), Math.cos(delta));
    }
    if (Math.abs(winding) < Math.PI * 1.48) return;
    this.portal = { ...center, radius: clamp(radius / aspect, .07, .42), born: now };
    this.circle = [];
  }

  snapshot() {
    return {
      hands: this.hands.map(hand => hand.palm),
      trails: this.trails.map(trail => trail.points.map(({ x, y }) => ({ x, y }))),
      body: this.body,
      portal: this.portal,
    };
  }

  command(root, now) {
    const hand = this.hands.find(candidate => candidate.side === this.controlHand && (candidate.pointing || this.pinch || candidate.pinched))
      || this.hands.find(candidate => candidate.pointing);
    if (!hand) {
      this.controlHand = null;
      this.hoverTarget = null;
      this.pinch = null;
      return null;
    }
    this.controlHand = hand.side;
    const bounds = root.getBoundingClientRect();
    const x = bounds.x + clamp((hand.pointer.x - .12) / .76) * bounds.width;
    const y = bounds.y + clamp((hand.pointer.y - .08) / .83) * bounds.height;
    const target = document.elementFromPoint(x, y)?.closest('button, input[type="range"], select');
    const actionable = target && root.contains(target) && !target.disabled ? target : null;
    if (!hand.pinched) {
      if (hand.pinchedOpen) this.pinch = null;
      if (hand.pointing && this.hoverTarget?.element !== actionable) this.hoverTarget = { element: actionable, at: now };
    } else if (!this.pinch && this.hoverTarget?.element && now - this.hoverTarget.at >= 140) {
      this.pinch = { target: this.hoverTarget.element, at: now, fired: false };
    }

    let progress = 0;
    let active = actionable;
    if (this.pinch) {
      active = this.pinch.target;
      const isRange = active.matches('input[type="range"]');
      if (isRange) {
        const rect = active.getBoundingClientRect();
        const ratio = active.id === 'intensity' ? 1 - (y - rect.top) / rect.height : (x - rect.left) / rect.width;
        const value = Number(active.min) + clamp(ratio) * (Number(active.max) - Number(active.min));
        active.value = String(value);
        active.dispatchEvent(new Event('input', { bubbles: true }));
        progress = 1;
      } else {
        const delay = active.dataset.hold === 'true' ? 850 : 225;
        progress = clamp((now - this.pinch.at) / delay);
        if (progress === 1 && !this.pinch.fired) {
          this.pinch.fired = true;
          if (active.matches('select')) {
            active.selectedIndex = (active.selectedIndex + 1) % active.options.length;
            active.dispatchEvent(new Event('change', { bubbles: true }));
          } else active.click();
        }
      }
    }
    return { x: x - bounds.x, y: y - bounds.y, active, progress, hand: hand.tip };
  }
}
