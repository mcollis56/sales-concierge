import OpenAI from 'openai';
import { google } from 'googleapis';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const auth = new google.auth.JWT(
  creds.client_email,
  undefined,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.SHEET_ID;

async function appendLead(row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Leads!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Use POST');

  const { message, threadId } = req.body;

  const thread = threadId
    ? await openai.beta.threads.retrieve(threadId)
    : await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: message
  });

  let run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: process.env.ASSISTANT_ID,
    stream: false
  });

  while (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
    if (run.status === 'requires_action') {
      for (const tc of run.required_action.submit_tool_outputs.tool_calls) {
        if (tc.function.name === 'createSheetRow') {
          const a = JSON.parse(tc.function.arguments);
          const row = [
            new Date().toISOString(),
            a.name, a.email, a.company ?? '',
            a.pain_point, a.budget_usd, a.timeline, a.score
          ];
          await appendLead(row);
          await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
            tool_outputs: [
              { tool_call_id: tc.id, output: JSON.stringify({ ok: true }) }
            ]
          });
        }
      }
    }
    run = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }

  const msgs = await openai.beta.threads.messages.list(thread.id, { limit: 1 });
  res.json({ threadId: thread.id, reply: msgs.data[0].content[0].text.value });
}
