sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    MessageToast,
    MessageBox
) {
    "use strict";

    return Controller.extend("generator.fiori.controller.Main", {

        onInit: function () {
            this._serviceUrl = "/cpi";
        },

        onGenerateIntegrationFlow: async function () {

            const oTextArea = this.byId("scenarioInput");
            const sPrompt = oTextArea.getValue().trim();

            if (!sPrompt) {
                MessageBox.warning(
                    "Please describe the integration scenario first."
                );
                return;
            }

            const oButton = this.byId("generateButton");

            try {

                oButton.setBusy(true);

                MessageToast.show(
                    "Generating integration flow..."
                );

                // downloadFlow is a GET function.
                // Prompt is therefore sent as a query parameter.
                const sUrl =
                    `${this._serviceUrl}/downloadFlow?prompt=${encodeURIComponent(sPrompt)}`;

                console.log(
                    "Calling downloadFlow:",
                    sUrl
                );

                const response = await fetch(
                    sUrl,
                    {
                        method: "GET",

                        headers: {
                            "Accept": "application/zip"
                        }
                    }
                );

                // ------------------------------------------------
                // ERROR RESPONSE
                // ------------------------------------------------

                if (!response.ok) {

                    let sError =
                        `HTTP ${response.status}`;

                    try {

                        const sContentType =
                            response.headers.get("Content-Type");

                        if (
                            sContentType &&
                            sContentType.includes("application/json")
                        ) {

                            const oError =
                                await response.json();

                            sError =
                                oError?.error?.message ||
                                oError?.message ||
                                sError;

                        } else {

                            const sText =
                                await response.text();

                            if (sText) {
                                sError = sText;
                            }
                        }

                    } catch (e) {

                        console.warn(
                            "Could not parse error response:",
                            e
                        );
                    }

                    throw new Error(sError);
                }

                // ------------------------------------------------
                // GET ZIP
                // ------------------------------------------------

                const oBlob =
                    await response.blob();

                if (!oBlob.size) {

                    throw new Error(
                        "CAP service returned an empty ZIP."
                    );
                }

                console.log(
                    `ZIP received: ${oBlob.size} bytes`
                );

                // ------------------------------------------------
                // FILE NAME
                // ------------------------------------------------

                let sFileName =
                    "GeneratedIntegrationFlow.zip";

                const sDisposition =
                    response.headers.get(
                        "Content-Disposition"
                    );

                if (sDisposition) {

                    const oMatch =
                        sDisposition.match(
                            /filename="?([^"]+)"?/i
                        );

                    if (oMatch && oMatch[1]) {
                        sFileName = oMatch[1];
                    }
                }

                // ------------------------------------------------
                // DOWNLOAD
                // ------------------------------------------------

                const sObjectUrl =
                    window.URL.createObjectURL(oBlob);

                const oLink =
                    document.createElement("a");

                oLink.href =
                    sObjectUrl;

                oLink.download =
                    sFileName;

                document.body.appendChild(oLink);

                oLink.click();

                oLink.remove();

                window.URL.revokeObjectURL(
                    sObjectUrl
                );

                MessageToast.show(
                    "Integration flow ZIP downloaded successfully."
                );

            } catch (error) {

                console.error(
                    "Integration flow generation failed:",
                    error
                );

                MessageBox.error(
                    error.message ||
                    "Unable to generate the integration flow."
                );

            } finally {

                oButton.setBusy(false);
            }
        }

    });

});