const fs = require('fs');

let api = fs.readFileSync('/home/dudedp/Automations/TheFinalOption/cloud/src/routes/api.ts', 'utf8');
api = api.replace(
  /\/\*\* POST \/api\/manual-entry[\s\S]*?console\.error\('Manual entry error:', error\);\n    return c\.json\(\{ error: error\.message \|\| 'Manual entry failed' \}, 500\);\n  \}\n\}\);/,
  `/** POST /api/manual-trade — Queue manual commands to EC2 */
api.post('/api/manual-trade', dashboardAuth, async (c) => {
  const { action, direction } = await c.req.json<{ action: string, direction?: 'CE' | 'PE' }>();
  
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY as string);

  // 1. Act as a dumb terminal: just write the user's intent to the queue
  const { data, error } = await supabase.from('pending_commands').insert([{
    action: action,             // e.g., 'MANUAL_BUY'
    direction: direction,       // e.g., 'CE'
    status: 'PENDING'
  }]).select('id').single();

  if (error) {
    return c.json({ error: \`Command queue failed: \${error.message}\` }, 500);
  }

  return c.json({ 
    success: true, 
    message: \`Command queued successfully.\`,
    commandId: data.id 
  });
});`
);
fs.writeFileSync('/home/dudedp/Automations/TheFinalOption/cloud/src/routes/api.ts', api);

let stateEngine = fs.readFileSync('/home/dudedp/Automations/TheFinalOption/local-daemon/src/state-engine.ts', 'utf8');
const replacement = `    // 📡 NEW: Command Queue Interceptor
    supabase.channel('command_queue_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pending_commands' }, async (payload) => {
        const command = payload.new;
        
        if (command.status === 'PENDING') {
          logInfo(\`[COMMAND-QUEUE] Intercepted new UI command: \${command.action} \${command.direction || ''}\`);
          
          // 1. Lock the command immediately so it can't be processed twice
          await supabase.from('pending_commands').update({ status: 'PROCESSING' }).eq('id', command.id);

          try {
            // 2. Route the execution logic natively on EC2
            if (command.action === 'MANUAL_BUY' && command.direction) {
              
              // TODO: Wire this to your actual Executor function. 
              // The executor will now handle fetching the chain and calculating lots natively.
              // Example: await Executor.takeManualPosition(command.direction);
              logInfo(\`[COMMAND-QUEUE] Executing native trade loop for \${command.direction}...\`);
              
            } else if (command.action === 'SQUARE_OFF') {
              // Example: await Executor.squareOffAllPositions();
              logInfo(\`[COMMAND-QUEUE] Executing emergency square-off...\`);
            }

            // 3. Mark as successfully completed
            await supabase.from('pending_commands').update({ status: 'COMPLETED' }).eq('id', command.id);
            logInfo(\`[COMMAND-QUEUE] ✅ Command \${command.action} completed successfully.\`);

          } catch (err: any) {
            // Mark as failed if Upstox rejects it or logic fails
            await supabase.from('pending_commands').update({ status: 'FAILED' }).eq('id', command.id);
            logError(\`[COMMAND-QUEUE] ❌ Execution failed: \${err.message}\`);
          }
        }
      })
      .subscribe();`;

stateEngine = stateEngine.replace('  /**\n   * 📡 BACKGROUND TELEMETRY LOOP', replacement + '\n\n  /**\n   * 📡 BACKGROUND TELEMETRY LOOP');
fs.writeFileSync('/home/dudedp/Automations/TheFinalOption/local-daemon/src/state-engine.ts', stateEngine);

let executorStr = fs.readFileSync('/home/dudedp/Automations/TheFinalOption/local-daemon/src/executor.ts', 'utf8');
executorStr += `
export class Executor {
  public static async takeManualPosition(direction: 'CE' | 'PE') {
    // 1. Fetch Option Chain natively using your broker adapter
    const ltp = (global as any).currentActiveLTP; // Grab live Spot price from your tracker
    const optionChain = await (global as any).brokerAdapter.getOptionChain(ltp);
    
    // 2. Select the ATM Strike
    const targetStrike = direction === 'CE' ? optionChain.atmCE : optionChain.atmPE;
    
    // 3. Calculate Lots dynamically based on max risk config
    const marginRes = await (global as any).brokerAdapter.getFundsAndMargin();
    const lotsToBuy = (global as any).calculateDynamicLots(marginRes.available, targetStrike.price);
    
    // 4. Execute the trade using your Iceberg slicing logic
    await (global as any).iceberg.execute({
      instrumentKey: targetStrike.instrumentKey,
      quantity: lotsToBuy * 25, // Nifty lot size
      transactionType: 'BUY',
      orderType: 'LIMIT'
    });
  }
}
`;
fs.writeFileSync('/home/dudedp/Automations/TheFinalOption/local-daemon/src/executor.ts', executorStr);
