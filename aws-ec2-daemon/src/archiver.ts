import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { supabase } from './database.js';
import { logInfo, logError } from './logger.js';

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

// =============================================================
// NIGHTLY DATABASE PRUNING & COMPRESSION
// =============================================================

export async function runNightlyArchiver() {
  logInfo('[ARCHIVER] 🧹 Initiating Nightly Database Pruning & Compression...');
  
  if (!supabase) {
    logError('[ARCHIVER] Supabase instance not initialized. Skipping nightly archive.');
    return;
  }

  // Define time thresholds
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  
  try {
    // 1. Wipe all 'NORMAL' conviction MTF Setups (Intraday noise)
    const { count: mtfNormalCount, error: mtfNormalErr } = await supabase
      .from('mtf_screened_stocks')
      .delete()
      .eq('conviction', 'NORMAL');
        
    if (mtfNormalErr) throw new Error(`MTF Normal Prune Error: ${mtfNormalErr.message}`);
    logInfo(`[ARCHIVER] 🗑️ Wiped NORMAL MTF setups to clear dashboard noise.`);

    // 2. Prune 'HIGH' conviction MTF Setups older than 3 days
    const { error: mtfHighErr } = await supabase
      .from('mtf_screened_stocks')
      .delete()
      .eq('conviction', 'HIGH')
      .lt('updated_at', threeDaysAgo);
        
    if (mtfHighErr) throw new Error(`MTF High Prune Error: ${mtfHighErr.message}`);
    logInfo(`[ARCHIVER] 🗑️ Cleared HIGH conviction setups older than 3 days.`);

    // 3. Prune Old System Telemetry / Logs older than 7 days
    const { error: telErr } = await supabase
      .from('system_telemetry')
      .delete()
      .lt('created_at', sevenDaysAgo);
        
    if (telErr && !telErr.message.includes('relation "system_telemetry" does not exist')) {
      throw new Error(`Telemetry Prune Error: ${telErr.message}`);
    }
    logInfo(`[ARCHIVER] 🗑️ Flushed system telemetry older than 7 days.`);

    logInfo('[ARCHIVER] ✨ Nightly pruning complete. EBS and PostgreSQL optimized.');

  } catch (error: any) {
    logError(`[ARCHIVER] ❌ Archiver failed: ${error.message}`);
  }
}

// -------------------------------------------------------------
// CRON SCHEDULER
// -------------------------------------------------------------
export function startArchiverCron() {
  // Runs at 23:59 (11:59 PM IST) every day
  cron.schedule('59 23 * * *', () => {
    runNightlyArchiver();
  }, {
    timezone: "Asia/Kolkata" // Force IST timezone so it aligns with Indian market timings
  });
  
  logInfo('[ARCHIVER] 🕒 Archiver Cron scheduled for 11:59 PM IST daily.');
}
