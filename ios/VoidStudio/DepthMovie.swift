import AVFoundation
import CoreImage

final class DepthMovie {
    let url: URL
    let geometry: DepthGeometry
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let firstTime: TimeInterval
    private var frames = 0

    init(geometry: DepthGeometry, firstTime: TimeInterval) throws {
        self.geometry = geometry
        self.firstTime = firstTime
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("VOID-LiDAR-\(UUID().uuidString).mp4")
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let width = Int(geometry.canvas.width)
        let height = Int(geometry.canvas.height)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height
        ])
        guard writer.canAdd(input) else { throw CaptureError.unavailable }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CaptureError.unavailable }
        writer.startSession(atSourceTime: .zero)
    }

    func append(_ image: CIImage, timestamp: TimeInterval, compositor: DepthCompositor) throws {
        if writer.status == .failed { throw writer.error ?? CaptureError.unavailable }
        guard writer.status == .writing, input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { return }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { return }
        compositor.write(image, to: buffer, bounds: geometry.bounds)
        let time = CMTime(seconds: max(0, timestamp - firstTime), preferredTimescale: 60_000)
        if adaptor.append(buffer, withPresentationTime: time) { frames += 1 }
        else if writer.status == .failed { throw writer.error ?? CaptureError.unavailable }
    }

    func finish(_ completion: @escaping (URL?) -> Void) {
        guard frames > 0, writer.status == .writing else {
            abort()
            completion(nil)
            return
        }
        input.markAsFinished()
        writer.finishWriting { [self] in
            if writer.status == .completed { completion(url) }
            else {
                try? FileManager.default.removeItem(at: url)
                completion(nil)
            }
        }
    }

    func abort() {
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: url)
    }

    enum CaptureError: Error {
        case unavailable
    }
}
