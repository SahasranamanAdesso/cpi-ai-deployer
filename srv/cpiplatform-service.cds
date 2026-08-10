@path: '/cpi'
service CPIService {
     @(Core: {
        MediaType: 'application/zip',
        ContentDisposition.Filename: 'flow.zip'
    })
    type FlowZip : LargeBinary;

    action translatePrompt(
        prompt : String
    ) returns String;

    action compileFlow(
        prompt : String
    ) returns String;

    function downloadFlow(
        prompt : String
    ) returns FlowZip;
}
