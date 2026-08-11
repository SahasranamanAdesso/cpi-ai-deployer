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

        resources: {
          type: [
            "groovy",
            "mapping",
            "xsd",
            "xslt"
          ],
          schema: {
            type: "string",
            name: "string",
            content: "string"
          },
          required: [
            "type",
            "name",
            "content"
          ]
        },

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

${JSON.stringify(capabilities, null, 2)}

IMPORTANT OUTPUT RULES

1. Return ONLY valid JSON.

2. Do not return Markdown.

3. Do not return code fences.

4. Do not explain the answer.

5. Use ONLY adapter types present in the compiler capabilities.

6. Use ONLY component types present in the compiler capabilities.

7. Use ONLY configuration properties supported by the compiler.

8. NEVER invent component types.

9. NEVER invent adapter types.

10. NEVER invent configuration properties.

11. NEVER convert a natural-language CPI concept into an
    invented compiler component.

12. Do not use implementation-specific SAP names unless they
    are explicitly present in the capabilities.

13. NEVER invent unsupported types such as:
    ScriptCollection
    CustomScript
    CustomAdapter
    UnknownComponent
    or any other unsupported type.

14. The generated JSON must be directly consumable by
    fromJson().

15. Preserve the user's requested component names as component
    configuration/name values where supported, but use valid
    generic compiler component types and schemas.

16. Do not create a component simply because a natural-language
    concept sounds like a CPI component. Use only types supported
    by the compiler.

17. If a requested capability cannot be represented by the
    compiler contract, do not invent a schema for it.


GENERIC IFLOW JSON STRUCTURE

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


SENDER AND RECEIVER

sender and receiver are top-level properties.

Do NOT create components named:

sender
receiver

Connections may reference:

sender
receiver

or actual component IDs.


CONNECTION RULES

Every requested component that participates in the message flow
must have the required explicit connections.

Connection format:

{
  "from": "componentId",
  "to": "componentId"
}

The special connection endpoints may be:

"sender"
"receiver"

All other connection endpoints must be actual component IDs.

Every connection target must actually exist.

Do not invent IDs.

Do not create connections to nonexistent components.


TYPICAL FLOW

sender
↓
component1
↓
component2
↓
receiver


ROUTER RULES

Router routes and connections MUST correspond.

Example structure:

{
  "id": "router1",
  "type": "Router",
  "config": {
    "routes": [
      {
        "condition": "\\\${header.Country} == 'IN'",
        "target": "groovy1"
      },
      {
        "condition": "\\\${header.Country} != 'IN'",
        "target": "receiver"
      }
    ]
  }
}

The corresponding connections must contain:

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

Router route targets must be either valid component IDs or valid
flow endpoints supported by the compiler contract.


GROOVY SCRIPT RULES

Use ONLY the GroovyScript schema exposed by the compiler.

Do NOT invent ScriptCollection.

Do NOT invent custom script properties.

If the compiler requires scriptName, provide scriptName.

When a Groovy resource is required, reference the resource using
the compiler-supported GroovyScript configuration.


RESOURCE RULES

Resources MUST be an array of OBJECTS.

Resources MUST NOT be an array of strings.

Every resource object MUST contain:

- type
- name
- content

Generic resource structure:

{
  "type": "groovy",
  "name": "transform.groovy",
  "content": "full resource content"
}

The supported resource type MUST come from the compiler
capabilities.

Do NOT invent resource types.

Do NOT generate:

"resources": [
  "groovy"
]

Do NOT generate:

"resources": [
  "transform.groovy"
]

Do NOT generate resource objects missing required fields.

Correct generic structure:

"resources": [
  {
    "type": "groovy",
    "name": "transform.groovy",
    "content": "def Message processData(Message message) { return message; }"
  }
]

For every requested resource, provide its complete content as
a string.

Do not use external filenames without the required resource
object.

Do not omit content.

RESOURCE PATH RULES

The resource packager automatically places resources into the
appropriate compiler resource directory based on their "type".

Therefore the resource "name" MUST be a filename or relative
filename only.

NEVER include the resource type directory in the name.

For XSD:

CORRECT:
{
    "type": "xsd",
    "name": "DomesticOrder.xsd",
    "content": "..."
}

INCORRECT:
{
    "type": "xsd",
    "name": "/xsd/DomesticOrder.xsd",
    "content": "..."
}

INCORRECT:
{
    "type": "xsd",
    "name": "xsd/DomesticOrder.xsd",
    "content": "..."
}

For Groovy:

CORRECT:
{
    "type": "groovy",
    "name": "transform.groovy",
    "content": "..."
}

INCORRECT:
{
    "type": "groovy",
    "name": "/groovy/transform.groovy",
    "content": "..."
}

For mapping:

CORRECT:
{
    "type": "mapping",
    "name": "OrderMapping.mmap",
    "content": "..."
}

For XSLT:

CORRECT:
{
    "type": "xslt",
    "name": "transform.xslt",
    "content": "..."
}

The compiler/packager is responsible for adding the appropriate
resource directory.

Never prefix resource names with:
"/xsd/"
"xsd/"
"/groovy/"
"groovy/"
"/mapping/"
"mapping/"
"/xslt/"
"xslt/"

Resource names must not begin with "/".

Resource names must not contain the resource type directory.

CONTENT MODIFIER RULES

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

Do not invent alternative property names when they are not
supported by the compiler.

PROCESSCALL RULES

ProcessCall is a compiler-supported component type.

IMPORTANT:

Do not create multiple ProcessCall components in the same
iFlow unless the compiler capabilities explicitly indicate
that multiple ProcessCall instances are supported.

If the requested scenario requires multiple independent
processing services and multiple ProcessCall instances cause
compiler validation errors, use supported adapter/component
types that can represent the requested processing services.

Never create duplicate internal compiler component instances.

Component IDs in the generated JSON MUST be unique.

Before returning the JSON, check that no two components have
the same id.

For example, this is valid at the JSON level:

{
    "id": "domesticService",
    "type": "ProcessCall"
}

{
    "id": "internationalService",
    "type": "ProcessCall"
}

However, if the compiler rejects multiple ProcessCall
instances, do not repeatedly regenerate the same structure.
Use an alternative supported representation.

URL RULES

URLs MUST be plain strings.

If the user provides a Markdown URL, extract only the actual URL.

For example:

Correct:

"https://example.com/orders"

Incorrect:

"[https://example.com/orders](https://example.com/orders)"

Do not preserve Markdown link syntax inside JSON string values.


FINAL VALIDATION RULES

Before returning JSON, verify:

- The JSON is syntactically valid.
- All adapter types are supported.
- All component types are supported.
- All configuration properties are supported.
- All resource objects have type, name, and content.
- All component IDs are unique.
- All connection endpoints exist.
- Every requested component is connected appropriately.
- Router targets correspond to actual components or valid flow
  endpoints.
- No unsupported component types are invented.
- No unsupported resource types are invented.
- No ScriptCollection is invented.
- No Markdown URLs remain.
- The result can be consumed directly by fromJson().

Return ONLY the complete compiler JSON.
`;
  }


  // ============================================================
  // AI -> COMPILER JSON
  //
  // Retries after actual compiler/factory/validation errors.
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
      // AI HUB CALL
      // ========================================================

      try {

        response =
          await axios.post(
            "https://adesso-ai-hub.3asabc.de/v1/chat/completions",
            {
              model:
                "gemma-4-26b-sovereign",

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


      // ========================================================
      // PARSED JSON
      // ========================================================

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
- Do NOT invent resource types.
- Resources MUST be objects with:
  { "type": "...", "name": "...", "content": "..." }
- Do NOT use ScriptCollection unless it exists in the compiler
  capabilities.
- If GroovyScript requires scriptName, provide scriptName.
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


      // ========================================================
      // VALIDATION RESULT
      // ========================================================

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


      // ========================================================
      // RETRY WITH ACTUAL VALIDATION ERROR
      // ========================================================

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

5. Do not invent resource types.

6. Use ONLY compiler capabilities.

7. Preserve valid parts of the JSON.

8. Every connection target must exist.

9. Every requested component must be connected.

10. Every Router route must have the appropriate connection.

11. If the error reports that a Router has N routes but fewer
    connections, add the missing connections.

12. If a GroovyScript requires scriptName, provide scriptName.

13. Resources MUST use this generic structure:

    {
      "type": "supported-resource-type",
      "name": "filename",
      "content": "complete file content"
    }

14. Never represent resources as strings.

15. Do not use ScriptCollection unless it is explicitly
    supported by the compiler.

16. Normalize Markdown URLs to plain URLs.

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

    let aiJson =
        await generateCompilerJson(prompt);

    // --------------------------------------------------------
    // Normalize resource filenames before compiler factory
    // --------------------------------------------------------

    aiJson =
        normalizeResourceNames(aiJson);

    let flow;

    try {

        flow =
            fromJson(aiJson);

    } catch (error) {

        throw new Error(
            `Invalid compiler JSON: ${error.message}`
        );
    }

    const validation =
        validate(flow);

    if (
        !validation.valid
    ) {

        throw new Error(
            JSON.stringify(validation)
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

  function normalizeResourceNames(aiJson) {

    if (
        !aiJson ||
        !Array.isArray(aiJson.resources)
    ) {
        return aiJson;
    }

    aiJson.resources =
        aiJson.resources.map(resource => {

            if (
                !resource ||
                typeof resource.name !== "string"
            ) {
                return resource;
            }

            let name =
                resource.name.trim();

            // Remove leading slash
            name =
                name.replace(/^\/+/, "");

            // Remove duplicated resource directory
            if (
                resource.type &&
                name.startsWith(
                    `${resource.type}/`
                )
            ) {
                name =
                    name.substring(
                        resource.type.length + 1
                    );
            }

            resource.name = name;

            return resource;
        });

    return aiJson;
}

});