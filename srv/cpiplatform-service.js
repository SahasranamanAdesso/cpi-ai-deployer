const cds = require("@sap/cds");
const axios = require("axios");
const { Readable } = require("stream");

const {
  fromJson,
  validate,
  compileToZip
} = require("@cpi-ai/compiler");

module.exports = cds.service.impl(function () {

  // ============================================================
  // COMPILER CAPABILITIES
  // ============================================================

  function getCompilerCapabilities() {

    try {

      const compiler =
        require("@cpi-ai/compiler");

      if (
        typeof compiler.getCapabilities === "function"
      ) {
        return compiler.getCapabilities();
      }

      /*
       * Fallback contract.
       * The compiler remains the final authority.
       */
      return {
        format: "IFlowJson",

        adapters: [
          "HTTP",
          "HTTPS",
          "OData",
          "SFTP",
          "SOAP",
          "IDoc"
        ],

        components: [
          "ContentModifier",
          "Router",
          "GroovyScript",
          "DataStore",
          "Multicast",
          "Splitter",
          "Gather",
          "MessageMapping",
          "XmlValidator",
          "XsltMapping",
          "ProcessCall"
        ],

        rules: {
          unknownTypes: "forbidden",
          inventedTypes: "forbidden",
          inventedProperties: "forbidden",
          sender: "top-level sender object",
          receiver: "top-level receiver object",
          connections:
            "reference sender, receiver, or component ids"
        }
      };

    } catch (error) {

      console.error(
        "Unable to discover compiler capabilities:",
        error
      );

      throw new Error(
        "Compiler capability discovery failed"
      );
    }
  }


  // ============================================================
  // SYSTEM PROMPT
  // ============================================================

  function buildSystemPrompt() {

    const capabilities =
      getCompilerCapabilities();

    return `
You are the AI translation layer for an SAP Integration Suite
iFlow compiler.

Translate the user's natural-language request into the exact
GENERIC JSON CONTRACT accepted by the compiler.

The compiler capabilities below are the AUTHORITATIVE source
of truth.

============================================================
COMPILER CAPABILITIES
============================================================

${JSON.stringify(capabilities, null, 2)}

============================================================
STRICT RULES
============================================================

1. Return ONLY valid JSON.

2. Do not return Markdown.

3. Do not return code fences.

4. Do not explain the answer.

5. Use ONLY adapter types present in the compiler capabilities.

6. Use ONLY component types present in the compiler
   capabilities.

7. Use ONLY configuration properties supported by the
   compiler.

8. NEVER invent component types.

9. NEVER invent adapter types.

10. NEVER invent configuration properties.

11. NEVER convert a natural-language CPI concept into an
    invented compiler component.

12. Do not use implementation-specific SAP names unless they
    are explicitly present in the capabilities.

13. In particular, NEVER invent:
    ScriptCollection
    CustomScript
    CustomAdapter
    UnknownComponent
    or any other unsupported type.

14. The generated JSON must be directly consumable by
    fromJson().

============================================================
JSON STRUCTURE
============================================================

{
  "name": "FlowName",

  "sender": {
    "type": "SUPPORTED_ADAPTER",
    "config": {}
  },

  "components": [
    {
      "id": "component1",
      "type": "SUPPORTED_COMPONENT",
      "config": {}
    }
  ],

  "receiver": {
    "type": "SUPPORTED_ADAPTER",
    "config": {}
  },

  "connections": [],

  "resources": []
}

============================================================
SENDER / RECEIVER
============================================================

sender and receiver are top-level properties.

Do NOT create components named:

sender
receiver

Connections may reference:

sender
receiver

or actual component IDs.

============================================================
CONNECTIONS
============================================================

Every requested component must be connected.

Every connection target must actually exist.

Typical structure:

sender
  ↓
component1
  ↓
component2
  ↓
receiver

============================================================
ROUTER
============================================================

Router routes and connections MUST correspond.

Example:

{
  "id": "router1",
  "type": "Router",
  "config": {
    "routes": [
      {
        "condition": "\${header.Country} == 'IN'",
        "target": "groovy1"
      },
      {
        "condition": "\${header.Country} != 'IN'",
        "target": "receiver"
      }
    ]
  }
}

The connections MUST contain:

{
  "from": "router1",
  "to": "groovy1"
}

and:

{
  "from": "router1",
  "to": "receiver"
}

Never create a Router route without its corresponding
connection.

============================================================
GROOVY SCRIPT
============================================================

Use ONLY the GroovyScript schema exposed by the compiler.

Do NOT invent ScriptCollection.

Do NOT invent script properties.

If the compiler requires scriptName, provide scriptName.

============================================================
CONTENT MODIFIER
============================================================

Use the compiler's canonical ContentModifier structure.

For example, when supported:

{
  "id": "cm1",
  "type": "ContentModifier",
  "config": {
    "headers": [
      {
        "name": "Country",
        "value": "IN"
      }
    ]
  }
}

============================================================
URL NORMALIZATION
============================================================

URLs MUST be plain strings.

Correct:

"https://example.com/orders"

Incorrect:

"[https://example.com/orders](https://example.com/orders)"

If the user provides a Markdown URL, extract only the actual
URL.

============================================================
FINAL RULE
============================================================

The compiler capabilities are the source of truth.

Do not guess.

Do not invent.

Return ONLY the complete compiler JSON.
`;
  }


  // ============================================================
  // AI -> COMPILER JSON
  //
  // IMPORTANT:
  // This function now retries after actual compiler errors.
  // ============================================================

  async function generateCompilerJson(prompt) {

    if (!prompt || !prompt.trim()) {
      throw new Error("Prompt is required");
    }

    const MAX_ATTEMPTS = 3;

    let currentPrompt = prompt;
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS;
      attempt++
    ) {

      console.log(
        `\n===== AI ATTEMPT ${attempt}/${MAX_ATTEMPTS} =====`
      );

      const systemPrompt =
        buildSystemPrompt();

      let response;

      // ========================================================
      // EXISTING AI HUB CALL
      // ========================================================

      try {

        response =
          await axios.post(
            "https://adesso-ai-hub.3asabc.de/v1/chat/completions",
            {
              model:
                "deepseek-v4-flash-sovereign",

              temperature: 0,

              messages: [
                {
                  role: "system",
                  content: systemPrompt
                },
                {
                  role: "user",
                  content: currentPrompt
                }
              ]
            },
            {
              headers: {
                Authorization:
                  `Bearer ${process.env.AI_HUB_API_KEY}`,

                "Content-Type":
                  "application/json"
              }
            }
          );

      } catch (error) {

        console.error(
          "AI request failed:",
          error.response?.data ||
          error.message
        );

        throw new Error(
          error.response?.data?.error?.message ||
          error.message ||
          "AI request failed"
        );
      }

      // ========================================================
      // RAW RESPONSE
      // ========================================================

      const raw =
        response.data
          ?.choices?.[0]
          ?.message?.content;

      if (!raw) {
        throw new Error(
          "AI returned no content"
        );
      }

      console.log(
        "\n===== RAW AI RESPONSE ====="
      );

      console.log(raw);

      console.log(
        "===========================\n"
      );

      // ========================================================
      // CLEAN JSON
      // ========================================================

      let cleaned =
        raw.trim();

      cleaned =
        cleaned
          .replace(
            /^```json\s*/i,
            ""
          )
          .replace(
            /^```\s*/i,
            ""
          )
          .replace(
            /\s*```$/i,
            ""
          )
          .trim();

      let aiJson;

      try {

        aiJson =
          JSON.parse(cleaned);

      } catch (error) {

        lastError =
          "AI returned invalid JSON";

        console.error(
          lastError
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            lastError
          );
        }

        currentPrompt = `
The previous response was not valid JSON.

ERROR:
${lastError}

ORIGINAL USER REQUEST:
${prompt}

Return the COMPLETE corrected compiler JSON.

Return ONLY JSON.
`;

        continue;
      }

      console.log(
        "\n===== PARSED AI JSON ====="
      );

      console.log(
        JSON.stringify(
          aiJson,
          null,
          2
        )
      );

      console.log(
        "==========================\n"
      );

      // ========================================================
      // FACTORY
      // ========================================================

      let flow;

      try {

        flow =
          fromJson(aiJson);

      } catch (error) {

        lastError =
          error.message ||
          String(error);

        console.error(
          "\n===== FACTORY ERROR ====="
        );

        console.error(
          lastError
        );

        console.error(
          "=========================\n"
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            `Invalid compiler JSON: ${lastError}`
          );
        }

        /*
         * Send ACTUAL compiler error back to AI.
         *
         * This is deliberately generic.
         *
         * We do NOT hard-code ScriptCollection,
         * Router IDs, Groovy IDs, etc.
         */

        currentPrompt = `
The compiler rejected the JSON you generated.

COMPILER ERROR:
${lastError}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL USER REQUEST:
${prompt}

Correct the JSON according to the compiler error.

IMPORTANT:

- Use ONLY compiler capabilities.
- Do NOT invent component types.
- Do NOT invent adapter types.
- Do NOT invent properties.
- Do NOT use ScriptCollection unless it exists in the
  compiler capabilities.
- If GroovyScript requires scriptName, provide it.
- Preserve valid portions.
- Make all references point to real component IDs.
- Make sure every requested component is connected.
- Make sure Router route targets have corresponding
  connections.

Return the COMPLETE corrected JSON only.
`;

        continue;
      }

      // ========================================================
      // VALIDATION
      // ========================================================

      let validation;

      try {

        validation =
          validate(flow);

      } catch (error) {

        lastError =
          error.message ||
          String(error);

        console.error(
          "\n===== VALIDATION EXCEPTION ====="
        );

        console.error(
          lastError
        );

        console.error(
          "================================\n"
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            lastError
          );
        }

        currentPrompt = `
The compiler validation threw an error.

COMPILER ERROR:
${lastError}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL REQUEST:
${prompt}

Correct the JSON.

Return ONLY the complete corrected JSON.
`;

        continue;
      }

      console.log(
        "\n===== VALIDATION ====="
      );

      console.log(
        validation
      );

      console.log(
        "======================\n"
      );

      // ========================================================
      // SUCCESS
      // ========================================================

      if (
        validation.valid
      ) {

        console.log(
          `===== VALID COMPILER JSON ON ATTEMPT ${attempt} =====`
        );

        return aiJson;
      }

      // ========================================================
      // VALIDATION FAILED
      // ========================================================

      lastError =
        JSON.stringify(
          validation,
          null,
          2
        );

      console.error(
        "\n===== COMPILER VALIDATION FAILED ====="
      );

      console.error(
        lastError
      );

      console.error(
        "=======================================\n"
      );

      if (
        attempt >= MAX_ATTEMPTS
      ) {
        throw new Error(
          lastError
        );
      }

      /*
       * Give the actual compiler validation back to AI.
       */

      currentPrompt = `
The compiler validation failed.

COMPILER VALIDATION:
${JSON.stringify(
  validation,
  null,
  2
)}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL USER REQUEST:
${prompt}

Fix the previous JSON.

IMPORTANT:

1. The compiler validation is authoritative.

2. Do not invent component types.

3. Do not invent adapter types.

4. Do not invent properties.

5. Use ONLY compiler capabilities.

6. Preserve valid parts of the JSON.

7. Every connection target must exist.

8. Every requested component must be connected.

9. Every Router route must have the appropriate connection.

10. If the error reports that a Router has N routes but fewer
    connections, add the missing connections.

11. If a GroovyScript requires scriptName, provide scriptName.

12. Do not use ScriptCollection unless it is explicitly
    supported by the compiler.

13. Normalize Markdown URLs to plain URLs.

Return the COMPLETE corrected compiler JSON only.
`;
    }

    throw new Error(
      lastError ||
      "Unable to generate valid compiler JSON"
    );
  }


  // ============================================================
  // BUILD FLOW
  // ============================================================

  async function buildFlow(prompt) {

    const aiJson =
      await generateCompilerJson(
        prompt
      );

    console.log(
      "\n===== FACTORY INPUT ====="
    );

    console.log(
      JSON.stringify(
        aiJson,
        null,
        2
      )
    );

    console.log(
      "=========================\n"
    );

    let flow;

    try {

      flow =
        fromJson(aiJson);

    } catch (error) {

      console.error(
        "\n===== FACTORY ERROR ====="
      );

      console.error(
        error
      );

      console.error(
        "=========================\n"
      );

      throw new Error(
        `Invalid compiler JSON: ${error.message}`
      );
    }

    const validation =
      validate(flow);

    console.log(
      "\n===== VALIDATION ====="
    );

    console.log(
      validation
    );

    console.log(
      "======================\n"
    );

    if (
      !validation.valid
    ) {

      throw new Error(
        JSON.stringify(
          validation
        )
      );
    }

    return {
      aiJson,
      flow,
      validation
    };
  }


  // ============================================================
  // TRANSLATE PROMPT
  // ============================================================

  this.on(
    "translatePrompt",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const aiJson =
          await generateCompilerJson(
            prompt
          );

        return JSON.stringify(
          aiJson
        );

      } catch (error) {

        console.error(
          "\n===== TRANSLATE ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "===========================\n"
        );

        return req.error(
          500,
          error.message ||
          "Translation failed"
        );
      }
    }
  );


  // ============================================================
  // COMPILE FLOW
  // ============================================================

  this.on(
    "compileFlow",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const {
          aiJson,
          flow,
          validation
        } =
          await buildFlow(
            prompt
          );

        const zip =
          await compileToZip(
            flow
          );

        const zipBuffer =
          Buffer.isBuffer(zip)
            ? zip
            : Buffer.from(zip);

        console.log(
          `ZIP generated: ${zipBuffer.length} bytes`
        );

        return JSON.stringify({
          status: "success",

          flowName:
            aiJson.name ||
            "AIGeneratedFlow",

          compilerJson:
            aiJson,

          validation,

          zipSize:
            zipBuffer.length,

          message:
            "AI → compiler capabilities → JSON → factory → validation → ZIP successful"
        });

      } catch (error) {

        console.error(
          "\n===== COMPILE ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "=========================\n"
        );

        return req.error(
          500,
          error.message ||
          "Compilation failed"
        );
      }
    }
  );


  // ============================================================
  // DOWNLOAD FLOW
  // ============================================================

  this.on(
    "downloadFlow",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const {
          flow,
          validation
        } =
          await buildFlow(
            prompt
          );

        if (
          !validation.valid
        ) {

          return req.error(
            400,
            JSON.stringify(
              validation
            )
          );
        }

        const zip =
          await compileToZip(
            flow
          );

        let zipBuffer;

        if (
          Buffer.isBuffer(zip)
        ) {

          zipBuffer =
            zip;

        } else if (
          zip instanceof Uint8Array
        ) {

          zipBuffer =
            Buffer.from(zip);

        } else if (
          zip instanceof ArrayBuffer
        ) {

          zipBuffer =
            Buffer.from(zip);

        } else {

          throw new Error(
            `compileToZip returned unsupported type: ${
              zip?.constructor?.name ||
              typeof zip
            }`
          );
        }

        console.log(
          `ZIP ready for download: ${zipBuffer.length} bytes`
        );

        /*
         * IMPORTANT:
         *
         * Return a real Readable stream.
         *
         * This avoids:
         *
         * Unexpected result type for streaming:
         * Expected stream.Readable or null but got object
         */

        return Readable.from([
          zipBuffer
        ]);

      } catch (error) {

        console.error(
          "\n===== DOWNLOAD ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "=========================\n"
        );

        return req.error(
          500,
          error.message ||
          "ZIP download failed"
        );
      }
    }
  );

});