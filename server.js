import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: process.env.FRONTEND_URL || "*", methods: ["POST", "GET"] }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "VerdePlate API", version: "1.0.0" });
});

app.post("/api/generate-plan", async (req, res) => {
  const { goal, activity, allergens, weight, height, age } = req.body;
  if (!goal || !activity) return res.status(400).json({ error: "Campos obrigatórios: goal, activity" });

  const GOALS = { lose: "Emagrecer", maintain: "Manter peso", gain: "Ganhar massa muscular" };
  const ACTIVITY = {
    sedentary: { label: "Sedentário", multiplier: 1.2 },
    light: { label: "Leve (1–3 dias/semana)", multiplier: 1.375 },
    moderate: { label: "Moderado (3–5 dias/semana)", multiplier: 1.55 },
    active: { label: "Ativo (6–7 dias/semana)", multiplier: 1.725 },
  };

  const w = parseFloat(weight) || 70;
  const h = parseFloat(height) || 170;
  const a = parseFloat(age) || 30;
  const bmr = 10 * w + 6.25 * h - 5 * a;
  const multiplier = ACTIVITY[activity]?.multiplier || 1.55;
  let tdee = Math.round(bmr * multiplier);
  if (goal === "lose") tdee -= 300;
  if (goal === "gain") tdee += 300;

  const goalLabel = GOALS[goal] || goal;
  const actLabel = ACTIVITY[activity]?.label || activity;
  const allergensLabel = allergens?.length ? allergens.join(", ") : "nenhuma";

  const prompt = `Você é um nutricionista vegano educativo. Crie um plano alimentar semanal vegano:
- Objetivo: ${goalLabel}
- Atividade: ${actLabel}
- Meta calórica: ${tdee} kcal
- Alergias: ${allergensLabel}
- Jejum matinal (apenas água/chá pela manhã)
Responda APENAS com JSON válido:
{"tdee":${tdee},"summary":"frase sobre o plano (max 80 chars)","days":[{"day":"Segunda","theme":"tema (max 20 chars)","color":"#hex","meals":[{"label":"Almoço","time":"12h","items":["item com quantidade"],"kcal":500,"tip":"dica (max 80 chars)"}]}]}
Gere 7 dias (Seg a Dom). Cada dia: Almoço (12h), Lanche (15h), Jantar (19h). 100% vegano. Evite: ${allergensLabel}.`;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Chave da API não configurada." });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });

    if (!response.ok) return res.status(502).json({ error: "Erro ao chamar a IA. Tente novamente." });

    const data = await response.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const plan = JSON.parse(clean);
    return res.json({ plan, tdee });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

app.listen(PORT, () => console.log(`✅ VerdePlate API rodando na porta ${PORT}`));
