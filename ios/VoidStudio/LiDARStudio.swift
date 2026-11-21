import ARKit
import AVFoundation
import SwiftUI
import UIKit

struct LiDARStudio: View {
    @ObservedObject var model: LiDARCamera
    @Environment(\.scenePhase) private var scenePhase
    @State private var effect: DepthStyle = .depth
    @State private var range = 3.0
    @State private var marker: CGPoint?

    var body: some View {
        VStack(spacing: 12) {
            GeometryReader { viewport in
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 25).fill(Color(white: 0.045))
                    if let preview = model.preview {
                        Image(decorative: preview, scale: 1)
                            .resizable()
                            .scaledToFill()
                            .frame(width: viewport.size.width, height: viewport.size.height)
                            .clipped()
                            .accessibilityLabel("Rear LiDAR camera preview")
                            .accessibilityHidden(false)
                            .accessibilityIdentifier("lidar-preview")
                    }
                    if let marker {
                        Image(systemName: "scope")
                            .font(.system(size: 28))
                            .foregroundStyle(.cyan)
                            .shadow(color: .black, radius: 4)
                            .position(x: marker.x * viewport.size.width, y: marker.y * viewport.size.height)
                            .allowsHitTesting(false)
                    }
                    HStack {
                        Label(model.status, systemImage: model.isRecording ? "record.circle.fill" : "viewfinder")
                            .foregroundStyle(model.isRecording ? Color.red : Color.cyan)
                            .accessibilityIdentifier("lidar-status")
                        Spacer()
                        if let distance = model.distance {
                            Text("\(distance, specifier: "%.2f") m")
                                .monospacedDigit()
                                .accessibilityIdentifier("lidar-distance")
                                .accessibilityLabel(Text("Distance \(distance, specifier: "%.2f") metres"))
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(12)
                    .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 14))
                    .padding(11)

                    if let message = model.message {
                        Text(message)
                            .multilineTextAlignment(.center)
                            .padding(16)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 17))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .padding()
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 25))
                .overlay(RoundedRectangle(cornerRadius: 25).strokeBorder(.cyan.opacity(0.45)))
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { tap in
                    guard model.preview != nil, viewport.size.width > 0, viewport.size.height > 0 else { return }
                    let point = CGPoint(x: tap.location.x / viewport.size.width, y: tap.location.y / viewport.size.height)
                    marker = point
                    model.measure(at: point)
                })
                .onChange(of: viewport.size, initial: true) { _, size in
                    let orientation = UIApplication.shared.connectedScenes
                        .compactMap { $0 as? UIWindowScene }
                        .first(where: { $0.activationState == .foregroundActive })?.interfaceOrientation ?? .portrait
                    model.setViewport(size, orientation: orientation)
                }
            }
            .frame(minHeight: 90)

            if model.supported {
                Picker("Depth effect", selection: $effect) {
                    ForEach(DepthStyle.allCases) { style in Text(style.rawValue).tag(style) }
                }
                .pickerStyle(.segmented)
                .onChange(of: effect, initial: true) { _, value in model.setEffect(value) }

                if effect != .camera {
                    HStack {
                        Text(effect == .veil ? "Veil starts" : "Map range")
                        Slider(value: $range, in: 0.5...5, step: 0.1)
                            .tint(.cyan)
                            .accessibilityLabel("Depth range in metres")
                        Text("\(range, specifier: "%.1f") m").monospacedDigit()
                    }
                    .font(.caption)
                }

                HStack(spacing: 17) {
                    Button(action: model.photo) { Label("Photo", systemImage: "camera") }
                        .disabled(model.preview == nil)
                    Button(action: model.toggleRecording) {
                        Label(model.isRecording ? "Stop" : "Record",
                              systemImage: model.isRecording ? "stop.circle.fill" : "record.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(model.preview == nil || model.saving)
                    if let output = model.output {
                        ShareLink(item: output) { Label("Share", systemImage: "square.and.arrow.up") }
                    }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.horizontal, 13)
        .padding(.bottom, 10)
        .onChange(of: range, initial: true) { _, value in model.setRange(Float(value)) }
        .onAppear { model.setActive(scenePhase == .active) }
        .onDisappear { model.setActive(false) }
        .onChange(of: scenePhase) { _, phase in model.setActive(phase == .active) }
    }
}

final class LiDARCamera: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var preview: CGImage?
    @Published private(set) var status = "Waiting for rear camera"
    @Published private(set) var message: String?
    @Published private(set) var distance: Float?
    @Published private(set) var isRecording = false
    @Published private(set) var saving = false
    @Published private(set) var output: URL?

    let supported = ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth)
        || ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    private let session = ARSession()
    private let queue = DispatchQueue(label: "studio.voidcamera.lidar", qos: .userInitiated)
    private let compositor = DepthCompositor()
    private var active = false
    private var viewport = CGSize(width: 390, height: 620)
    private var orientation = UIInterfaceOrientation.portrait
    private var effect = DepthStyle.depth
    private var range: Float = 3
    private var point: CGPoint?
    private var latest: CGImage?
    private var lastFrame: TimeInterval = 0
    private var movie: DepthMovie?
    private var beginMovie = false
    private var wrappingUp = false

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = queue
    }

    func setActive(_ value: Bool) {
        queue.async {
            guard self.active != value else { return }
            self.active = value
            if !value {
                self.session.pause()
                self.latest = nil
                self.finishMovie()
                DispatchQueue.main.async {
                    self.preview = nil
                    self.distance = nil
                    self.status = "Camera paused"
                }
            } else if !self.supported {
                self.updateStatus("LiDAR unavailable", message: "Use Studio for camera effects on this device.")
            } else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
                self.startSession()
            } else {
                AVCaptureDevice.requestAccess(for: .video) { allowed in
                    self.queue.async {
                        guard self.active else { return }
                        if allowed { self.startSession() }
                        else { self.updateStatus("Camera permission needed", message: "Allow Camera access for VOID Studio in Settings.") }
                    }
                }
            }
        }
    }

    private func startSession() {
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth)
            ? .smoothedSceneDepth : .sceneDepth
        lastFrame = 0
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        updateStatus("Starting LiDAR", message: nil)
    }

    func setViewport(_ size: CGSize, orientation: UIInterfaceOrientation) {
        guard size.width > 0, size.height > 0 else { return }
        queue.async {
            self.viewport = size
            self.orientation = orientation == .unknown ? .portrait : orientation
        }
    }

    func setEffect(_ value: DepthStyle) { queue.async { self.effect = value } }
    func setRange(_ value: Float) { queue.async { self.range = value } }
    func measure(at point: CGPoint) { queue.async { self.point = point } }

    func photo() {
        queue.async {
            guard let image = self.latest, let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.94) else { return }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("VOID-LiDAR-\(UUID().uuidString).jpg")
            do {
                try data.write(to: url, options: .atomic)
                DispatchQueue.main.async { self.output = url }
            } catch {
                self.updateStatus("Photo could not be saved", message: nil)
            }
        }
    }

    func toggleRecording() {
        queue.async {
            guard !self.wrappingUp else { return }
            if self.movie != nil || self.beginMovie { self.finishMovie() }
            else if self.active && self.latest != nil { self.beginMovie = true }
        }
    }

    private func finishMovie() {
        beginMovie = false
        guard let movie else { return }
        self.movie = nil
        wrappingUp = true
        DispatchQueue.main.async {
            self.isRecording = false
            self.saving = true
        }
        movie.finish { url in
            self.queue.async { self.wrappingUp = false }
            DispatchQueue.main.async {
                self.saving = false
                if let url { self.output = url }
                else { self.status = "Video could not be saved" }
            }
        }
    }

    private func updateStatus(_ status: String, message: String?) {
        DispatchQueue.main.async {
            self.status = status
            self.message = message
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard active, frame.timestamp - lastFrame >= 1 / 24.0 else { return }
        lastFrame = frame.timestamp
        let geometry = DepthGeometry(frame: frame, orientation: orientation, viewport: viewport)
        let depth = frame.smoothedSceneDepth ?? frame.sceneDepth
        let image = compositor.render(frame: frame, depth: depth, geometry: geometry, style: effect, range: range)
        if beginMovie {
            beginMovie = false
            do {
                movie = try DepthMovie(geometry: geometry, firstTime: frame.timestamp)
                DispatchQueue.main.async { self.isRecording = true }
            } catch {
                updateStatus("Recording unavailable", message: nil)
            }
        }
        if let movie {
            let capture = movie.geometry.imageToView == geometry.imageToView && movie.geometry.canvas == geometry.canvas
                ? image : compositor.render(frame: frame, depth: depth, geometry: movie.geometry, style: effect, range: range)
            do {
                try movie.append(capture, timestamp: frame.timestamp, compositor: compositor)
            } catch {
                finishMovie()
            }
        }
        guard let preview = compositor.preview(image, in: geometry.bounds) else { return }
        latest = preview
        let distance = depth.flatMap { data in point.flatMap { compositor.sample(data, at: $0, geometry: geometry) } }
        let label = movie == nil ? (depth == nil ? "Waiting for depth" : "LiDAR live") : "Recording"
        DispatchQueue.main.async {
            self.preview = preview
            if self.distance != distance { self.distance = distance }
            if self.status != label { self.status = label }
            if self.message != nil { self.message = nil }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        finishMovie()
        updateStatus("LiDAR unavailable", message: error.localizedDescription)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        finishMovie()
        updateStatus("Camera interrupted", message: "Return to VOID Studio to resume the LiDAR camera.")
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        if active { startSession() }
    }
}
