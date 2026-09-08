import Foundation

nonisolated final class CancellableProcessBox: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false

    func register(_ process: Process) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else { return false }
        self.process = process
        return true
    }

    func clear(_ process: Process) {
        lock.lock()
        if self.process === process {
            self.process = nil
        }
        lock.unlock()
    }

    func cancel() {
        let running: Process?
        lock.lock()
        cancelled = true
        running = process
        lock.unlock()
        if running?.isRunning == true {
            running?.terminate()
        }
    }
}
