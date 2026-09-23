@path: '/deploy'
service DeployService {
    action deployIflow(
        id        : String,
        name      : String,
        packageId : String,
        zipBase64 : LargeString
    ) returns {
        jobId : String;
    };

    function deploymentStatus(
        jobId : String
    ) returns {
        jobId      : String;
        status     : String;
        artifactId : String;
        error      : String;
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
