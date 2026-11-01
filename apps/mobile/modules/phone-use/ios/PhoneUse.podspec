Pod::Spec.new do |s|
  s.name           = 'PhoneUse'
  s.version        = '1.0.0'
  s.summary        = 'Records phone unlocks for Nodara driving reports'
  s.description    = 'Records when the iPhone is unlocked so Nodara can count phone use while driving.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Nodara contributors'
  s.homepage       = 'https://github.com/solynx-dev/nodara'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/solynx-dev/nodara.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
