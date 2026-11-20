import ARKit
import CoreImage
import UIKit

enum DepthStyle: String, CaseIterable, Identifiable {
    case camera = "Camera"
    case depth = "Depth map"
    case veil = "Depth veil"

    var id: Self { self }
}

struct DepthGeometry {
    let canvas: CGSize
    let source: CGSize
    let imageToView: CGAffineTransform

    init(frame: ARFrame, orientation: UIInterfaceOrientation, viewport: CGSize) {
        let longest = max(viewport.width, viewport.height)
        let scale = min(1, 960 / max(1, longest))
        canvas = CGSize(
            width: max(2, (viewport.width * scale / 2).rounded() * 2),
            height: max(2, (viewport.height * scale / 2).rounded() * 2)
        )
        source = CGSize(
            width: CVPixelBufferGetWidth(frame.capturedImage),
            height: CVPixelBufferGetHeight(frame.capturedImage)
        )
        imageToView = frame.displayTransform(for: orientation, viewportSize: canvas)
    }

    var bounds: CGRect { CGRect(origin: .zero, size: canvas) }

    // ARKit projects normalized top-left coordinates. Core Image works in bottom-left pixels.
    var renderTransform: CGAffineTransform {
        func output(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            let normalized = CGPoint(x: x / source.width, y: 1 - y / source.height)
                .applying(imageToView)
            return CGPoint(x: normalized.x * canvas.width, y: (1 - normalized.y) * canvas.height)
        }
        let origin = output(0, 0)
        let right = output(1, 0)
        let up = output(0, 1)
        return CGAffineTransform(
            a: right.x - origin.x, b: right.y - origin.y,
            c: up.x - origin.x, d: up.y - origin.y,
            tx: origin.x, ty: origin.y
        )
    }
}

struct DepthCompositor {
    private let context = CIContext(options: [.cacheIntermediates: false])
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    func render(
        frame: ARFrame, depth: ARDepthData?, geometry: DepthGeometry, style: DepthStyle, range: Float
    ) -> CIImage {
        let camera = CIImage(cvPixelBuffer: frame.capturedImage)
        var image = camera
        if style != .camera, let depth, let overlay = overlay(for: depth, style: style, range: range) {
            let sized = CIImage(cgImage: overlay).transformed(by: CGAffineTransform(
                scaleX: geometry.source.width / CGFloat(overlay.width),
                y: geometry.source.height / CGFloat(overlay.height)
            ))
            image = sized.composited(over: camera)
        }
        return image.transformed(by: geometry.renderTransform).cropped(to: geometry.bounds)
    }

    func preview(_ image: CIImage, in bounds: CGRect) -> CGImage? {
        context.createCGImage(image, from: bounds, format: .RGBA8, colorSpace: colorSpace)
    }

    func write(_ image: CIImage, to buffer: CVPixelBuffer, bounds: CGRect) {
        context.render(image, to: buffer, bounds: bounds, colorSpace: colorSpace)
    }

    func sample(_ data: ARDepthData, at point: CGPoint, geometry: DepthGeometry) -> Float? {
        let coordinate = point.applying(geometry.imageToView.inverted())
        guard (0..<1).contains(coordinate.x), (0..<1).contains(coordinate.y) else { return nil }
        return withDepth(data) { width, height, read in
            let x = Int(coordinate.x * CGFloat(width))
            let y = Int(coordinate.y * CGFloat(height))
            var nearby: [Float] = []
            for row in max(0, y - 1)...min(height - 1, y + 1) {
                for column in max(0, x - 1)...min(width - 1, x + 1) {
                    if let value = read(column, row) { nearby.append(value) }
                }
            }
            nearby.sort()
            return nearby.isEmpty ? nil : nearby[nearby.count / 2]
        } ?? nil
    }

    private func overlay(for data: ARDepthData, style: DepthStyle, range: Float) -> CGImage? {
        withDepth(data) { width, height, read in
            var bytes = [UInt8](repeating: 0, count: width * height * 4)
            for y in 0..<height {
                for x in 0..<width {
                    guard let metres = read(x, y) else { continue }
                    let amount = min(1, max(0, (metres - 0.2) / max(0.1, range - 0.2)))
                    let color: (Float, Float, Float, Float)
                    if style == .veil {
                        let alpha = min(0.93, max(0, (metres - range) * 1.3))
                        color = (0.05, 0.04, 0.18, alpha)
                    } else {
                        color = (0.08 + 0.65 * amount, 0.94 - 0.78 * amount, 0.92 + 0.06 * amount, 0.62)
                    }
                    let pixel = (y * width + x) * 4
                    bytes[pixel] = UInt8(color.0 * color.3 * 255)
                    bytes[pixel + 1] = UInt8(color.1 * color.3 * 255)
                    bytes[pixel + 2] = UInt8(color.2 * color.3 * 255)
                    bytes[pixel + 3] = UInt8(color.3 * 255)
                }
            }
            guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
            return CGImage(
                width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                space: colorSpace, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent
            )
        } ?? nil
    }

    private func withDepth<T>(
        _ data: ARDepthData, _ consume: (Int, Int, (Int, Int) -> Float?) -> T
    ) -> T? {
        let map = data.depthMap
        let format = CVPixelBufferGetPixelFormatType(map)
        guard format == kCVPixelFormatType_DepthFloat32 || format == kCVPixelFormatType_OneComponent32Float,
              CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        let stride = CVPixelBufferGetBytesPerRow(map)
        let confidence = data.confidenceMap.flatMap { buffer -> CVPixelBuffer? in
            guard CVPixelBufferGetWidth(buffer) == width, CVPixelBufferGetHeight(buffer) == height,
                  CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
            return buffer
        }
        defer { if let confidence { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) } }
        let confidenceBase = confidence.flatMap { CVPixelBufferGetBaseAddress($0) }
        let confidenceStride = confidence.map { CVPixelBufferGetBytesPerRow($0) } ?? 0
        return consume(width, height) { x, y in
            if let confidenceBase, confidenceBase.load(fromByteOffset: y * confidenceStride + x, as: UInt8.self) == 0 {
                return nil
            }
            let value = base.load(fromByteOffset: y * stride + x * MemoryLayout<Float>.size, as: Float.self)
            return value.isFinite && value > 0 ? value : nil
        }
    }
}
