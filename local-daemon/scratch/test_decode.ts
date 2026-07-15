import protobuf from 'protobufjs';
import path from 'path';

async function run() {
  const root = await protobuf.load('./local-daemon/src/MarketDataFeed.proto');
  const FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");
  
  // Use the exact hex from the log
  const hex = '0801129d010a124e53455f494e4445587c4e69667479203530128601128101127f0a1909333333331381d7401080e4f8fdf5';
  const buffer = Buffer.from(hex, 'hex');
  
  const decoded = FeedResponse.decode(buffer);
  console.log("JSON:", JSON.stringify(decoded, null, 2));
  console.log("Keys in feeds:", Object.keys((decoded as any).feeds || {}));
}

run().catch(console.error);
