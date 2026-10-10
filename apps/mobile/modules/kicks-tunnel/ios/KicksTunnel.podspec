Pod::Spec.new do |s|
  s.name = 'KicksTunnel'
  s.version = '0.1.0'
  s.summary = 'KICKS native iOS collector connection adapter'
  s.description = 'Native connection controls; no credentials are exposed to JavaScript.'
  s.author = 'DataStorm Inc.'
  s.homepage = 'https://github.com/GlobalCommerce91210/KICKS_101_Android-'
  s.license = { :type => 'Proprietary' }
  s.platforms = { :ios => '16.0' }
  s.source = { :git => s.homepage }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NetworkExtension', 'Security', 'CryptoKit'
  s.swift_version = '5.0'
  s.source_files = '**/*.swift'
end
