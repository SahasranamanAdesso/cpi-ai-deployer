@path: '/deploy'
service DeployService {
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
