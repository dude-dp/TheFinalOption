// local-daemon/src/iceberg.ts

export interface IcebergConfig {
  minLotsPerSlice: number;
  maxLotsPerSlice: number;
  baseDelayMs: number;
  jitterMs: number;
}

/**
 * Fractures a large order into randomized chunks to mask footprint.
 */
export function generateIcebergSlices(totalLots: number, config: IcebergConfig): number[] {
  if (totalLots <= config.maxLotsPerSlice) {
    return [totalLots]; // Order is small enough, execute in one shot
  }

  const slices: number[] = [];
  let remaining = totalLots;

  while (remaining > 0) {
    if (remaining <= config.maxLotsPerSlice) {
      slices.push(remaining);
      break;
    }

    // Generate a random slice size between min and max
    let slice = Math.floor(Math.random() * (config.maxLotsPerSlice - config.minLotsPerSlice + 1)) + config.minLotsPerSlice;

    // Prevent leaving a tiny remnant smaller than the minimum slice size
    if (remaining - slice < config.minLotsPerSlice) {
      slices.push(remaining);
      break;
    } else {
      slices.push(slice);
      remaining -= slice;
    }
  }

  return slices;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
