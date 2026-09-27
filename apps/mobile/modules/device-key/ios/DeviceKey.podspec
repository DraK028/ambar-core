Pod::Spec.new do |s|
  s.name           = 'DeviceKey'
  s.version        = '0.1.0'
  s.summary        = 'Llave ECDSA P-256 en Secure Enclave con Face ID / Touch ID'
  s.description    = 'Módulo local de Ámbar: genera la llave de dispositivo y firma retos de step-up.'
  s.author         = 'Ámbar'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'LocalAuthentication', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
