// Backend de Benito (el chatbot de Plenia) — Cloudflare Worker.
//
// Guarda tu API key de Anthropic de forma segura (nunca en el HTML/JS del navegador) y le
// hace de intermediario a Benito para hablar con Claude de verdad.
//
// Cómo desplegarlo — ver las instrucciones completas que te dio Claude en el chat. Resumen:
//   1. npm install -g wrangler
//   2. wrangler login
//   3. cd benito-backend
//   4. wrangler secret put ANTHROPIC_API_KEY   (te va a pedir que pegues tu llave, una sola vez)
//   5. wrangler deploy
//   6. Copia la URL que te da ("https://benito-api.<tu-usuario>.workers.dev") y pégala en
//      BENITO_API_URL, dentro de dashboard_onboarding_geb_36.html

// Cambia esto por el dominio real donde vive Plenia en GitHub Pages, para que solo esa página
// pueda usar tu backend (evita que cualquiera se conecte directo a tu Worker y gaste tu saldo).
const ALLOWED_ORIGIN = 'https://universidadgeb-creator.github.io';

const SYSTEM_PROMPT = `Eres Benito Delgado, una rana mascota de VIVO 47 (parte de GEB) que ahora ayuda a colaboradores a usar Plenia, el panel interno de RH de la empresa.

Reglas:
- Contesta en español, en tono amigable, cercano y breve (2 a 4 líneas, casi nunca más).
- Puedes ayudar a navegar Plenia. Secciones que existen: Inicio, Bandeja de entrada, Calendario, Perfil, Formación (Preonboarding/Encuesta 30 días/Evaluación Inducción/Certificaciones — solo administradores), Documentos, Organización (directorio y organigrama), Políticas, Desempeño (evaluaciones), Ausencias, Retención (solo administradores), Configuración (solo administradores).
- NUNCA inventes políticas de RH, cifras de sueldo, prestaciones, ni datos personales de nadie. Si no sabes algo con certeza, dilo claramente y sugiere contactar a su líder o al equipo de Capital Humano.
- No tienes acceso a los datos reales del colaborador que te escribe (nombre, sucursal, sueldo, etc.) a menos que la persona te los diga en el mensaje.
- Si te preguntan algo que no tiene que ver con Plenia o con temas de trabajo en GEB, redirige la conversación amablemente.`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Falta configurar ANTHROPIC_API_KEY en el Worker.' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'JSON inválido.' }, 400);
    }

    const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    if (!messages.length) {
      return jsonResponse({ error: 'Falta el mensaje.' }, 400);
    }

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // rápido y barato; sube a 'claude-sonnet-5' si quieres respuestas más elaboradas
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages,
        }),
      });
    } catch (e) {
      return jsonResponse({ error: 'No se pudo conectar con Anthropic.' }, 502);
    }

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      return jsonResponse({ error: 'Anthropic devolvió un error.', detail }, 502);
    }

    const data = await anthropicRes.json();
    const texto = data.content && data.content[0] && data.content[0].text
      ? data.content[0].text
      : 'No pude pensar en una respuesta, intenta de nuevo.';
    return jsonResponse({ texto });
  },
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };
}
