import cron from 'node-cron';
import { supabase } from './database.js';
import { logInfo, logError } from './logger.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_MTF_WEBHOOK || process.env.DISCORD_WEBHOOK_URL || '';

export async function generateAndSendMorningBriefing() {
    logInfo('[MORNING-BRIEF] 🌅 Initiating AI Morning Quant Briefing...');

    try {
        // 1. Fetch yesterday's HIGH conviction setups
        // We look at everything updated in the last 24 hours
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const todayStr = new Date().toISOString().split('T')[0];
        
        if (!supabase) {
            logError('[MORNING-BRIEF] ❌ Supabase client is null. Cannot fetch setups.');
            return;
        }

        // 0. Idempotency Check
        const { data: existing } = await supabase
            .from('system_events')
            .select('id')
            .eq('event_type', 'MORNING_BRIEFING')
            .contains('details', { briefing_date: todayStr })
            .maybeSingle();
            
        if (existing) {
            logInfo(`[MORNING-BRIEF] ⏩ Briefing already generated for ${todayStr}. Skipping.`);
            return;
        }

        const { data: setups, error } = await supabase
            .from('mtf_screened_stocks')
            .select('*')
            .eq('conviction', 'HIGH')
            .gte('updated_at', yesterday);

        if (error) throw error;

        let briefingText = "";

        // 2. Handle empty setup days (Protecting Capital)
        if (!setups || setups.length === 0) {
            briefingText = "⚠️ **CRO Briefing:** No high-conviction, dual-timeframe setups survived the gatekeeper at yesterday's close. Market breadth is likely deteriorating or choppy. Recommendation: Preserve capital, remain flat on new MTF swing entries today, and let the intraday Nifty options bot handle the chop.";
        } else {
            // 3. Prepare the Prompt for Groq Llama-3 8B
            const prompt = `You are the Chief Risk Officer for a quantitative trading desk. 
Review the following high-conviction MTF equity setups detected at yesterday's close: 
${JSON.stringify(setups)}

Write a concise, 3-paragraph Morning Briefing for the lead trader.
Paragraph 1: Summarize the sector momentum and overall breadth based on the stocks provided.
Paragraph 2: Highlight the 1 or 2 absolute best setups (mention their MACD signal, RVOL, and VWAP extension).
Paragraph 3: Give strict risk management directives (remind the trader to respect the calculated ATR Stop Losses and MTF leverage limits).

Tone: Professional, ruthless, highly analytical. No fluff, no pleasantries, no greetings. Focus purely on price action, risk, and execution.`;

            // 4. Call Groq API
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant', // Blazing fast, massive context window
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2 // Low temp for analytical consistency
                })
            });

            if (!response.ok) throw new Error(`Groq API Error: ${response.status} ${response.statusText}`);
            
            const result = await response.json() as any;
            briefingText = result.choices[0].message.content;
        }

        // 4b. Save to Database
        try {
            const { error: dbError } = await supabase.from('system_events').insert({
                event_type: 'MORNING_BRIEFING',
                message: briefingText,
                details: { 
                    briefing_date: todayStr,
                    timestamp: new Date().toISOString(),
                    setups_count: setups ? setups.length : 0,
                    model: 'llama-3.1-8b-instant'
                }
            });
            if (dbError) {
                logError(`[MORNING-BRIEF] ❌ Database Insert Error: ${dbError.message}`);
            } else {
                logInfo('[MORNING-BRIEF] ✅ Saved briefing to Supabase.');
            }
        } catch (dbErr: any) {
            logError(`[MORNING-BRIEF] ❌ Database Write Exception: ${dbErr.message}`);
        }

        // 5. Push to Discord
        if (DISCORD_WEBHOOK_URL) {
            const message = {
                embeds: [{
                    title: `☕ Quant Desk Morning Briefing (\${todayStr})`,
                    description: briefingText,
                    color: 16766720, // Morning Gold Color
                    footer: { text: "TheFinalOption • AI Risk Officer" },
                    timestamp: new Date().toISOString()
                }]
            };

            try {
                const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(message)
                });
                if (discordRes.ok) {
                    logInfo('[MORNING-BRIEF] ✅ Briefing successfully delivered to Discord.');
                } else {
                    logError(`[MORNING-BRIEF] ❌ Discord returned error: ${discordRes.status}`);
                }
            } catch (discordErr: any) {
                logError(`[MORNING-BRIEF] ❌ Discord Push Exception: ${discordErr.message}`);
            }
        } else {
            logError('[MORNING-BRIEF] ❌ Discord Webhook URL is missing.');
        }

    } catch (err: any) {
        logError(`[MORNING-BRIEF] ❌ Failed to generate briefing: ${err.message}`);
    }
}

// -------------------------------------------------------------
// CRON SCHEDULER
// -------------------------------------------------------------
export function startMorningBriefingCron() {
    // Runs at 08:30 AM every Monday through Friday
    // @ts-ignore
    cron.schedule('30 8 * * 1-5', () => {
        generateAndSendMorningBriefing();
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    } as any);
    
    logInfo('[MORNING-BRIEF] 🕒 AI Briefing Cron scheduled for 08:30 AM IST (Mon-Fri).');
}
