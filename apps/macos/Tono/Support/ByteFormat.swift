import Foundation

/// One byte/rate vocabulary for the whole app.
///
/// Dashboard used to hand-roll `"%.1f KB/s"` while Activity ran a
/// `ByteCountFormatter`, so the same idle moment read `0.0 KB/s` on one page and
/// `0 字节 /s` on the other — different floors, different words, and a stray
/// space before the slash. Both surfaces call this instead.
enum TonoByteFormat {
    /// Binary units with abbreviated labels: `0 B`, `348 KB`, `11.6 MB`.
    static func bytes(_ count: Int64) -> String {
        let value = max(0, count)
        guard value >= 1024 else { return "\(value) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var scaled = Double(value) / 1024
        var unit = units[0]
        for next in units.dropFirst() {
            if scaled < 1024 { break }
            scaled /= 1024
            unit = next
        }
        // Whole numbers past KB read as noise at one decimal ("348.0 KB").
        let precision = scaled >= 100 ? 0 : 1
        return String(format: "%.\(precision)f %@", scaled, unit)
    }

    /// A rate as a single token, never `"0 字节 /s"`.
    static func rate(_ bytesPerSecond: Int64) -> String {
        "\(bytes(bytesPerSecond))/s"
    }
}
