import {
  ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} from 'expo/config-plugins';
import fs from 'fs';
import path from 'path';

const PACKAGE = 'com.sparkyapps.sparkyfitness.workoutnotification';
const PACKAGE_IMPORT = `import ${PACKAGE}.WorkoutNotificationPackage`;
const PACKAGE_ADD = 'add(WorkoutNotificationPackage())';
const SOURCE = 'targets/android-workout-notification';

const withWorkoutNotification: ConfigPlugin = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const project = config.modRequest.projectRoot;
      const platform = config.modRequest.platformProjectRoot;
      await fs.promises.cp(
        path.join(project, SOURCE, 'kotlin'),
        path.join(platform, 'app/src/main/java'),
        { recursive: true }
      );
      return config;
    },
  ]);

  config = withMainApplication(config, (config) => {
    let source = config.modResults.contents;
    if (!source.includes(PACKAGE_IMPORT)) {
      const imports = source.match(/((?:^import [^\n]+\n)+)/m);
      source = imports
        ? source.replace(imports[1], `${imports[1]}${PACKAGE_IMPORT}\n`)
        : `${PACKAGE_IMPORT}\n${source}`;
    }
    if (!source.includes(PACKAGE_ADD)) {
      const block = source.match(
        /PackageList\(this\)\.packages\.apply\s*\{\s*\n/
      );
      if (!block || block.index == null) {
        throw new Error(
          '[withWorkoutNotification] MainApplication package list not found'
        );
      }
      const offset = block.index + block[0].length;
      source = `${source.slice(0, offset)}              ${PACKAGE_ADD}\n${source.slice(offset)}`;
    }
    config.modResults.contents = source;
    return config;
  });
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    application.receiver = application.receiver ?? [];
    const name = `${PACKAGE}.RestDeadlineReceiver`;
    if (
      !application.receiver.some(
        (receiver) => receiver.$?.['android:name'] === name
      )
    ) {
      application.receiver.push({
        $: { 'android:name': name, 'android:exported': 'false' },
      });
    }
    return config;
  });
  return config;
};

export default withWorkoutNotification;
