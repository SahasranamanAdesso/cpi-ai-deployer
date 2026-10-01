@path: '/deploy'
service DeployService {
    @(Core: {
        MediaType: 'application/zip',
        ContentDisposition.Filename: 'iflow.zip'
    })
    type IflowZip : LargeBinary;

    action generateAndDeploy(
        id          : String,
        name        : String,
        packageId   : String,
        description : LargeString
    ) returns {
        jobId : String;
    };

    action fixAndRedeploy(
        jobId : String
    ) returns {
        jobId : String;
    };

    action deployZip(
        id          : String,
        name        : String,
        packageId   : String,
        zipBase64   : LargeString,
        description : LargeString
    ) returns {
        jobId : String;
    };

    action addManualJob(
        id          : String,
        name        : String,
        packageId   : String,
        description : LargeString
    ) returns {
        jobId : String;
    };

    function listJobs() returns array of {
        jobId          : String;
        id             : String;
        name           : String;
        packageId      : String;
        source         : String;
        status         : String;
        attemptCount   : Integer;
        canRetry       : Boolean;
        hasDescription : Boolean;
        createdAt      : String;
        updatedAt      : String;
    };

    function jobStatus(
        jobId : String
    ) returns {
        jobId         : String;
        status        : String;
        artifactId    : String;
        attemptCount  : Integer;
        canRetry      : Boolean;
        attemptsJson  : LargeString;
        error         : String;
    };

    function downloadZip(
        jobId         : String,
        attemptNumber : Integer
    ) returns IflowZip;

    function listErrorArtifacts() returns array of {
        Id         : String;
        Name       : String;
        Status     : String;
        DeployedBy : String;
        DeployedOn : String;
    };

    function getArtifactError(
        id : String
    ) returns {
        id      : String;
        detail  : String;
    };
}
