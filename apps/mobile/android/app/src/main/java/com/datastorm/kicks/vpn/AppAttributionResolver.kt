package com.datastorm.kicks.vpn

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.VpnService
import android.os.Build
import android.os.Process
import android.system.OsConstants
import android.util.Log
import java.net.InetAddress
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

data class AppAttribution(val packageName:String?,val displayName:String?,val category:String?,val attribution:String,val attributionMethod:String?,val sourceUid:Int?,val attributionFailureReason:String?,val attributionSignals:List<String>,val attributionLookupAttempts:Int,val sharedUidPackageCount:Int?,val signingCertificateSha256:String?,val installedAt:String?,val lastUpdatedAt:String?,val isSystemApp:Boolean?,val versionName:String?,val versionCode:String?)

object AppAttributionResolver {
 private const val PACKAGE_CACHE_TTL_MS=5*60*1000L
 private const val OWNER_LOOKUP_ATTEMPTS=3
 private const val OWNER_LOOKUP_RETRY_DELAY_MS=2L
 private data class CachedAttribution(val expiresAtMs:Long,val value:AppAttribution)
 private data class OwnerLookup(val uid:Int,val attempts:Int)
 private val packageCache=ConcurrentHashMap<Int,CachedAttribution>()
 fun resolve(service:VpnService,query:DnsQuery):AppAttribution{
  if(Build.VERSION.SDK_INT<Build.VERSION_CODES.Q)return unknown("api_below_29",attempts=0)
  return runCatching{val connectivity=service.getSystemService(ConnectivityManager::class.java);val local=InetSocketAddress(InetAddress.getByAddress(query.source),query.sourcePort);val remote=InetSocketAddress(InetAddress.getByAddress(query.destination),53);val owner=lookupOwnerUid(connectivity,local,remote);if(owner.uid==Process.INVALID_UID)return unknown("connection_not_found",attempts=owner.attempts);resolvePackageIdentity(service.packageManager,owner.uid,owner.attempts)}.onFailure{Log.w("KicksCollector","app_attribution_unavailable reason=lookup_error",it)}.getOrElse{unknown("lookup_error",attempts=1)}
 }
 fun clearCache(){packageCache.clear()}
 private fun lookupOwnerUid(connectivity:ConnectivityManager,local:InetSocketAddress,remote:InetSocketAddress):OwnerLookup{for(attempt in 1..OWNER_LOOKUP_ATTEMPTS){val uid=connectivity.getConnectionOwnerUid(OsConstants.IPPROTO_UDP,local,remote);if(uid!=Process.INVALID_UID)return OwnerLookup(uid,attempt);if(attempt<OWNER_LOOKUP_ATTEMPTS)Thread.sleep(OWNER_LOOKUP_RETRY_DELAY_MS)};return OwnerLookup(Process.INVALID_UID,OWNER_LOOKUP_ATTEMPTS)}
 private fun resolvePackageIdentity(pm:PackageManager,uid:Int,attempts:Int):AppAttribution{val now=System.currentTimeMillis();packageCache[uid]?.takeIf{it.expiresAtMs>now}?.let{return it.value.copy(attributionLookupAttempts=attempts)};val packages=pm.getPackagesForUid(uid)?.distinct()?.sorted().orEmpty();val resolved=when{packages.isEmpty()->unknown("package_not_visible",uid,attempts,signals=listOf("dns_query","socket_owner_uid"));packages.size>1->unknown("shared_uid",uid,attempts,"best_effort",packages.size,listOf("dns_query","socket_owner_uid","shared_uid_mapping"));else->packageAttribution(pm,uid,packages.single(),attempts)};packageCache[uid]=CachedAttribution(now+PACKAGE_CACHE_TTL_MS,resolved);return resolved}
 private fun packageAttribution(pm:PackageManager,uid:Int,packageName:String,attempts:Int):AppAttribution{val ai=runCatching{pm.getApplicationInfo(packageName,0)}.getOrNull();val pi=runCatching{if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.P)pm.getPackageInfo(packageName,PackageManager.GET_SIGNING_CERTIFICATES)else @Suppress("DEPRECATION") pm.getPackageInfo(packageName,PackageManager.GET_SIGNATURES)}.getOrNull();val cert=signingCertificateSha256(pi);val metadataResolved=ai!=null&&pi!=null;val signals=buildList{add("dns_query");add("socket_owner_uid");add("package_uid_mapping");if(metadataResolved)add("package_metadata");if(cert!=null)add("signing_certificate")};return AppAttribution(packageName,ai?.let{pm.getApplicationLabel(it).toString().takeIf(String::isNotBlank)}?:packageName,ai?.let(::categoryLabel)?:"other",if(metadataResolved)"verified" else "best_effort","android_connection_owner_uid",uid,if(metadataResolved)null else "package_metadata_unavailable",signals,attempts,null,cert,pi?.firstInstallTime?.takeIf{it>0}?.let(java.time.Instant::ofEpochMilli)?.toString(),pi?.lastUpdateTime?.takeIf{it>0}?.let(java.time.Instant::ofEpochMilli)?.toString(),ai?.let{it.flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)!=0},pi?.versionName,pi?.let{if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.P)it.longVersionCode.toString()else @Suppress("DEPRECATION") it.versionCode.toString()})}
 private fun signingCertificateSha256(pi:android.content.pm.PackageInfo?):String?{val signatures=if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.P)pi?.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") pi?.signatures;return signatures.orEmpty().map{MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString(""){b->"%02x".format(b)}}.sorted().firstOrNull()}
 private fun unknown(reason:String,uid:Int?=null,attempts:Int,attribution:String="unknown",sharedUidPackageCount:Int?=null,signals:List<String>=listOf("dns_query"))=AppAttribution(null,null,null,attribution,if(uid==null)null else "android_connection_owner_uid",uid,reason,signals,attempts,sharedUidPackageCount,null,null,null,null,null,null)
 private fun categoryLabel(info:ApplicationInfo):String=when(info.category){ApplicationInfo.CATEGORY_GAME->"gaming";ApplicationInfo.CATEGORY_AUDIO,ApplicationInfo.CATEGORY_VIDEO,ApplicationInfo.CATEGORY_IMAGE->"entertainment";ApplicationInfo.CATEGORY_SOCIAL->"social";ApplicationInfo.CATEGORY_NEWS->"news";ApplicationInfo.CATEGORY_MAPS,ApplicationInfo.CATEGORY_PRODUCTIVITY->"utility";else->"other"}
}
