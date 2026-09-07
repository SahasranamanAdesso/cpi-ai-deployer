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
}
