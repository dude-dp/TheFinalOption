import fs from 'fs';
import path from 'path';

export interface RawTick {
  instrumentToken: string;
  ltp: number;
  timestamp: number;
}

export class TickArchiver {
  private stream: fs.WriteStream | null = null;
  private currentDate: string = '';
  private dataDir: string;

  constructor() {
    // Save data one level above src to keep it clean
    this.dataDir = path.join(process.cwd(), 'data', 'ticks');
    
    // Ensure the directory exists on boot
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Automatically handles midnight rollovers for CSV files.
   * Uses UTC time (which easily encompasses the IST trading session).
   */
  private rotateStreamIfNeeded() {
    const today = new Date().toISOString().split('T')[0]; 
    
    if (this.currentDate !== today) {
      if (this.stream) {
        this.stream.end(); // Gracefully close yesterday's file
      }
      
      this.currentDate = today;
      const filePath = path.join(this.dataDir, `ticks_${today}.csv`);
      const isNewFile = !fs.existsSync(filePath);
      
      // 'a' flag = Append mode. Will create file if it doesn't exist.
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
      
      // Inject CSV headers for brand new files
      if (isNewFile) {
        this.stream.write('timestamp,instrument_token,ltp\n');
      }
    }
  }

  /**
   * Fires a non-blocking write directly to the OS disk buffer.
   */
  public recordTick(tick: RawTick) {
    this.rotateStreamIfNeeded();
    
    if (this.stream) {
      // High-performance string interpolation bypassing JSON.stringify overhead
      this.stream.write(`${tick.timestamp},${tick.instrumentToken},${tick.ltp}\n`);
    }
  }

  /**
   * Call this on SIGINT/SIGTERM to prevent file corruption
   */
  public close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
