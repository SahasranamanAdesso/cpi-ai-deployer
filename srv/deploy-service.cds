@path: '/deploy'
@requires: 'DeployIFlow'
service DeployService {
    action deployIflow(
        id        : String,
        name      : String,
        packageId : String,
        zipBase64 : LargeString
    ) returns {
        status : String;
    };
}
