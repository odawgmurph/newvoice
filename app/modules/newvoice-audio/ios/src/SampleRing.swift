import os

/// A fixed-size queue of samples from the realtime audio callback to the
/// analysis thread.
///
/// Writing never allocates. The lock is held only to copy a few hundred
/// samples, which is the usual compromise for a spike; a lock-free ring is
/// the Stage 2 follow-up if the device matrix shows audio glitches. When
/// the reader falls behind by more than the capacity, the oldest samples
/// are dropped and counted.
final class SampleRing {
  private let capacity: Int
  private let storage: UnsafeMutablePointer<Float>
  private let lock: UnsafeMutablePointer<os_unfair_lock>
  // Total samples written and read since the start (monotonic).
  private var written = 0
  private var read = 0
  private var droppedTotal = 0

  init(capacity: Int) {
    self.capacity = capacity
    storage = .allocate(capacity: capacity)
    storage.initialize(repeating: 0, count: capacity)
    lock = .allocate(capacity: 1)
    lock.initialize(to: os_unfair_lock())
  }

  deinit {
    storage.deallocate()
    lock.deallocate()
  }

  /// Audio thread: appends `count` samples, taking every `stride`-th value
  /// (so channel 0 of interleaved audio).
  func write(_ source: UnsafePointer<Float>, count: Int, stride: Int) {
    os_unfair_lock_lock(lock)
    defer { os_unfair_lock_unlock(lock) }
    for i in 0..<count {
      storage[written % capacity] = source[i * stride]
      written += 1
    }
    if written - read > capacity {
      droppedTotal += written - read - capacity
      read = written - capacity
    }
  }

  /// Analysis thread: replaces `out` with every sample not read yet, and
  /// returns the total number of samples dropped so far.
  @discardableResult
  func drain(into out: inout [Float]) -> Int {
    out.removeAll(keepingCapacity: true)
    os_unfair_lock_lock(lock)
    defer { os_unfair_lock_unlock(lock) }
    while read < written {
      out.append(storage[read % capacity])
      read += 1
    }
    return droppedTotal
  }

  /// Forgets everything (on restart).
  func reset() {
    os_unfair_lock_lock(lock)
    defer { os_unfair_lock_unlock(lock) }
    written = 0
    read = 0
    droppedTotal = 0
  }
}
