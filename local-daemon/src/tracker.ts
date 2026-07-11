// local-daemon/src/tracker.ts

export class ApiTracker {
  private static callTimestamps: number[] = [];

  // Call this right before making ANY fetch request to Upstox
  public static recordCall() {
    const now = Date.now();
    this.callTimestamps.push(now);
    
    // Memory cleanup: Remove timestamps older than 60 seconds
    this.callTimestamps = this.callTimestamps.filter(t => now - t < 60000);
  }

  public static getMetrics() {
    const now = Date.now();
    
    // Count calls in the last 1000ms
    const reqPerSecond = this.callTimestamps.filter(t => now - t < 1000).length;
    // Count calls in the last 60000ms
    const reqPerMinute = this.callTimestamps.length;

    return { reqPerSecond, reqPerMinute };
  }
}
