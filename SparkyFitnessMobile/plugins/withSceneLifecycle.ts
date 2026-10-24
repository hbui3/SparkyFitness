// Adopts the UIScene life cycle on iOS. Apps built with the iOS 27 SDK
// (Xcode 27) that still launch through a UIApplicationDelegate-owned window
// are killed by UIKit at launch (EXC_BREAKPOINT in
// _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
//
// expo 57.0.25 ships ExpoAppSceneDelegate, but the SDK 57 prebuild template
// still generates the old AppDelegate. This plugin applies the same three
// changes the SDK 58 template makes, so it can be deleted once the app moves
// to SDK 58:
//   1. AppDelegate conforms to ExpoReactNativeFactoryProvider and no longer
//      creates the window or starts React Native itself.
//   2. SceneDelegate.swift (a bare ExpoAppSceneDelegate subclass) is added to
//      the app target; it creates the window and starts React Native.
//   3. Info.plist declares the scene manifest pointing at SceneDelegate.
//
// The Linking overrides in AppDelegate stay: ExpoAppSceneDelegate forwards
// scene URL / user-activity events to them and dedupes RCTLinkingManager.
import {
  ConfigPlugin,
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} from 'expo/config-plugins';
import fs from 'fs';
import path from 'path';

const SCENE_DELEGATE_FILE = 'SceneDelegate.swift';

const SCENE_DELEGATE_SOURCE = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

const APP_DELEGATE_CLASS = 'class AppDelegate: ExpoAppDelegate {';
const APP_DELEGATE_CLASS_WITH_PROVIDER =
  'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

const WINDOW_START_BLOCK =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;
const WINDOW_START_REPLACEMENT =
  '    // The window is created and React Native is started by `SceneDelegate`\n' +
  '    // under the scene-based life cycle (required by the iOS 27 SDK).\n';

function adoptSceneLifecycleInAppDelegate(src: string): string {
  if (src.includes(APP_DELEGATE_CLASS_WITH_PROVIDER)) return src;

  if (!src.includes(APP_DELEGATE_CLASS) || !WINDOW_START_BLOCK.test(src)) {
    throw new Error(
      '[withSceneLifecycle] AppDelegate.swift does not match the SDK 57 template ' +
        '(class declaration or window/startReactNative block not found). ' +
        'Update this plugin, or remove it if the template already adopts SceneDelegate.'
    );
  }

  return src
    .replace(APP_DELEGATE_CLASS, APP_DELEGATE_CLASS_WITH_PROVIDER)
    .replace(WINDOW_START_BLOCK, WINDOW_START_REPLACEMENT);
}

const withSceneLifecycle: ConfigPlugin = (config) => {
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error(
        '[withSceneLifecycle] Expected a Swift AppDelegate; got ' +
          config.modResults.language
      );
    }
    config.modResults.contents = adoptSceneLifecycleInAppDelegate(
      config.modResults.contents
    );
    return config;
  });

  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const sourceRoot = IOSConfig.Paths.getSourceRoot(
        config.modRequest.projectRoot
      );
      await fs.promises.writeFile(
        path.join(sourceRoot, SCENE_DELEGATE_FILE),
        SCENE_DELEGATE_SOURCE
      );
      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      config.modRequest.projectRoot
    );
    const filepath = `${projectName}/${SCENE_DELEGATE_FILE}`;
    if (!config.modResults.hasFile(filepath)) {
      // Defaults to the `com.apple.product-type.application` target, i.e. the
      // phone app — not the watch or widget extension targets.
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });

  return config;
};

export default withSceneLifecycle;
