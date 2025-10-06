### Create expo project

1. ts app config
2. setup different bundle id for dev and production

### Setup EAS

1. eas config
2. eas build
3. setup eas env: https://docs.expo.dev/eas/environment-variables/

### Create firebase project

1. Setup android/ios app
2. download configuration
3. setup app config
4. install packages and add plugin settings
5. Setup Apple sign in: [Apple Sign In
   ](https://firebase.google.com/docs/auth/ios/apple?hl=zh-CN&authuser=0&_gl=1*18ofzwd*_ga*MjE0NDIzOTIzNS4xNzQwNDAxOTM3*_ga_CW55HF8NVT*czE3NDkyOTQ0NzYkbzg1JGcxJHQxNzQ5Mjk1Mjc3JGo1NSRsMCRoMA)
6. Setup Google sign in:
   1. SHA1 Key: cd android && ./gradlew signingReport
   2. Re-download firebase config file
   3. https://rnfirebase.io/auth/social-auth#google
7. **Customize email content**

### Setup Apple Connect

1. Create new app
2. Setup Subscription (submit screenshot)
3. Setup industry and discount

### Create Revenue cat project

1. Setup product
2. Setup offering and entitlement
3. Setup Paywall
4. Setup firebase hook (analysis & purchase)
5. Initialize in code

# Tips

##### expo run ios with ios folder removed:

open clash with global mode

##### List simulators

xcrun simctl list devices

###### List physical machines

xcrun devicectl list devices

##### Download simulators

xcodebuild -downloadAllPlatforms

##### Select installed xcode version

```zsh
sudo xcode-select -s /Users/fuweikai/Downloads/Xcode.app/Contents/Developer
```

# Issues

##### DVTDeviceOperation: Encountered a build number "" that is incompatible with DVTBuildVersion.

##### AI SDK polyfill needed
