import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "10kb" }));
app.use(cors({ origin: process.env.FRONTEND_URL || "*", methods: ["POST", "GET"] }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "VerdePlate API", version: "1.1.0" });
});

// ── Gerar plano semanal ───────────────────────────────────────────────────────

app.post("/api/generate-plan", async (req, res) => {
  const { goal, activity, allergens, weight, height, age, substituir, refeicaoAtual, itensAtuais, dia } = req.body;

  if (!goal || !activity) {
    return res.status(400).json({ error: "Campos obrigatórios: goal, activity" });
  }

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Chave da API não configurada." });

  // ── Modo substituição ──────────────────────────────────────────────────────

  if (substituir && refeicaoAtual) {
    const subPrompt = `Você é um nutricionista vegano. Sugira uma alternativa para a seguinte refeição vegana:
- Refeição: ${refeicaoAtual} do dia ${dia || ""}
- Itens atuais: ${itensAtuais || ""}
- Objetivo do usuário: ${goalLabel}
- Nível de atividade: ${actLabel}
- Alergias: ${allergensLabel}

Responda APENAS com JSON válido, sem texto antes ou depois:
{
  "label": "${refeicaoAtual}",
  "time": "horário (ex: 12h)",
  "items": ["item 1 com quantidade", "item 2", "item 3"],
  "kcal": número,
  "tip": "dica nutricional curta (máx 80 chars)"
}
A sugestão deve ser diferente da atual, 100% vegana, sem: ${allergensLabel}.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: subPrompt }] }),
      });
      if (!response.ok) return res.status(502).json({ error: "Erro ao chamar a IA." });
      const data = await response.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const substitution = JSON.parse(clean);
      return res.json({ substitution });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Erro ao gerar substituição." });
    }
  }

  // ── Modo plano completo ────────────────────────────────────────────────────

  const prompt = `Você é um nutricionista vegano educativo. Crie um plano alimentar semanal vegano:
- Objetivo: ${goalLabel}
- Atividade: ${actLabel}
- Meta calórica: ${tdee} kcal/dia
- Alergias: ${allergensLabel}
- Jejum matinal (apenas água/chá pela manhã)

REGRAS:
1. Todas as refeições 100% veganas
2. Sem refeição matinal — apenas sugestão de líquidos
3. Evite completamente: ${allergensLabel}
4. Cada dia cobre proteínas, carboidratos, gorduras boas e vitaminas
5. Foque em prevenir letargia: combine carboidrato + proteína, inclua ferro+vit.C juntos

Responda APENAS com JSON válido:
{
  "tdee": ${tdee},
  "summary": "frase sobre o plano (máx 80 chars)",
  "days": [
    {
      "day": "Segunda",
      "theme": "tema do dia (máx 20 chars)",
      "color": "#hex",
      "meals": [
        {
          "label": "Almoço",
          "time": "12h",
          "items": ["item 1 com quantidade", "item 2", "item 3", "item 4"],
          "kcal": 500,
          "tip": "dica nutricional (máx 80 chars)"
        }
      ]
    }
  ]
}
Gere 7 dias (Seg a Dom). Cada dia: Almoço (12h), Lanche (15h), Jantar (19h).
Cores variadas: verde, teal, âmbar, roxo, rosa, laranja, azul.`;

  try {
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

app.listen(PORT, () => console.log(`✅ VerdePlate API v1.1 rodando na porta ${PORT}`));
