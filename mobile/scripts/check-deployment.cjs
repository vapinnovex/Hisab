const { createDeploymentConfig } = require('./deployment-config.cjs');

try {
  const config = createDeploymentConfig(process.env);
  // Print only the validated routing configuration, never process.env or credentials.
  console.log(JSON.stringify(config, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
