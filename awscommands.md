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