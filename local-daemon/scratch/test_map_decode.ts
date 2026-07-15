import protobuf from 'protobufjs';
import path from 'path';

async function run() {
  const root = await protobuf.load('./local-daemon/src/MarketDataFeed.proto');
  const FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");
  
  const payload = {
    type: 1,
    feeds: {
      "NSE_INDEX|Nifty 50": {
        fullFeed: {
          indexFF: {
            ltpc: {
              ltp: 24000.5
            }
          }
        }
      }
    }
  };
  
  const err = FeedResponse.verify(payload);
  if (err) throw Error(err);
  
  const message = FeedResponse.create(payload);
  const buffer = FeedResponse.encode(message).finish();
  
  console.log("Encoded Hex:", Buffer.from(buffer).toString('hex'));
  
  const decoded = FeedResponse.decode(buffer);
  console.log("Decoded JSON:", JSON.stringify(decoded));
  console.log("Decoded feeds keys:", Object.keys((decoded as any).feeds || {}));
}

run().catch(console.error);
