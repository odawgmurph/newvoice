Pod::Spec.new do |s|
  s.name           = 'NewVoiceDiscreet'
  s.version        = '0.1.0'
  s.summary        = 'Switches NewVoice to a discreet home-screen icon'
  s.description    = 'Sets one of the alternate app icons that plugins/withAlternateIcons.js adds to the iOS asset catalog.'
  s.author         = 'NewVoice'
  s.license        = 'Apache-2.0'
  s.homepage       = 'https://github.com/odawgmurph/newvoice'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '*.swift'
end
