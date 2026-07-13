## Force inject the build script
npm pkg set scripts.build="tsc"

## Ensure the compiler is installed
npm install typescript @types/node --save-dev

## Build and Restart
npm run build


## Start daemon
pm2 start ecosystem.config.cjs

## save process list
pm2 save --force

## env update pm2
pm2 restart all --update-env

## flush pm2 and start new
pm2 delete all && pm2 start ecosystem.config.cjs




## watch logs

http://<YOUR_ELASTIC_IP>:3847/admin/logs