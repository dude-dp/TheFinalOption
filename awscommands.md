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

http://13.205.66.82:3847/admin/logs

# 1. Brutally assassinate the corrupted PM2 daemon
pm2 kill

# 2. Clear any lingering PM2 cache/dump files
pm2 cleardump

# 3. Start the daemon fresh using our ecosystem file
pm2 start ecosystem.config.cjs

# 4. Save the clean state so it boots correctly on server restarts
pm2 save --force


git fetch --all
git reset --hard origin/main
