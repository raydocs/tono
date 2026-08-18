import Foundation

struct LogEntry: Identifiable {
    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()

    let id = UUID()
    let level: String
    let message: String
    let timestamp: Date

    var formattedTime: String {
        Self.timestampFormatter.string(from: timestamp)
    }
}
