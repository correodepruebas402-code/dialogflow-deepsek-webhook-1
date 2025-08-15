// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

// Seguridad opcional: protege el webhook con un token propio
const requireAuth = (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next(); // sin política si no configuras secret
  const header = req.headers["authorization"] || "";
  if (header === `Bearer ${secret}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
};

// Cliente DeepSeek (API compatible OpenAI)
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const MAX_TURNS = 12; // para no crecer tokens

// Healthcheck (para Render y prueba local)
app.get("/", (_req, res) => res.status(200).send("OK"));

/**
 * Webhook para Dialogflow ES.
 * Espera un WebhookRequest y responde con fulfillmentText + (opcional) outputContexts
 */
app.post("/webhook", requireAuth, async (req, res) => {
  try {
    const df = req.body || {};
    const session = df.session || "";
    const userText = df.queryResult?.queryText ?? "";

    // Lee/recupera historial desde el contexto "deepseek_session"
    const ctxs = df.queryResult?.outputContexts || [];
    const ctxSuffix = "/contexts/deepseek_session";
    const found = ctxs.find(c => c.name?.endsWith(ctxSuffix));
    let history = (found?.parameters?.history || []);
    if (!Array.isArray(history)) history = [];

    // Mensaje de sistema (controla el tono)
    const systemPrompt =
      "Eres un asistente útil, claro y conciso. Responde en español neutro.";

    const messages = [
      { role: "system", content: systemPrompt },
      ...history, // [{role:'user'|'assistant', content:string}, ...]
      { role: "user", content: userText },
    ];

    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    const completion = await deepseek.chat.completions.create({
      model,
      messages,
      // temperature: 0.7, // si quieres ajustar creatividad
    });

    const answer =
      completion?.choices?.[0]?.message?.content ||
      "Lo siento, no pude generar respuesta.";

    // Actualiza historial y devuelve contexto para mantener conversación
    const newHistory = [
      ...history,
      { role: "user", content: userText },
      { role: "assistant", content: answer },
    ].slice(-MAX_TURNS);

    const ctxName = `${session}/contexts/deepseek_session`;

    return res.json({
      fulfillmentText: answer,
      outputContexts: [
        {
          name: ctxName,
          lifespanCount: 20,
          parameters: { history: newHistory },
        },
      ],
    });
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err);
    return res.json({
      fulfillmentText:
        "Tuvimos un problema técnico hablando con el modelo. Intenta de nuevo.",
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Webhook listening on http://0.0.0.0:${port}`)
);
