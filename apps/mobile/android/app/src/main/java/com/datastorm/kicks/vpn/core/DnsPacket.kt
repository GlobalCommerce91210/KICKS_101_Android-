package com.datastorm.kicks.vpn.core

/** A parsed IPv4/UDP DNS question. The DNS payload is only used for forwarding, never stored. */
class DnsQuery(
  val qname: String?,
  val srcIp: ByteArray,
  val dstIp: ByteArray,
  val srcPort: Int,
  val dstPort: Int,
  val payload: ByteArray
)

object DnsPacket {
  fun parse(packet: ByteArray, length: Int = packet.size): DnsQuery? {
    if (length < 28 || length > packet.size) return null
    if ((packet[0].toInt() ushr 4) != 4) return null
    val ihl = (packet[0].toInt() and 0x0f) * 4
    if (ihl < 20 || length < ihl + 8 + 12) return null
    if ((packet[9].toInt() and 0xff) != 17) return null
    val totalLen = u16(packet, 2)
    if (totalLen < ihl + 8 + 12 || totalLen > length) return null
    // Non-first fragments carry no UDP header.
    if ((u16(packet, 6) and 0x1fff) != 0) return null
    val srcPort = u16(packet, ihl)
    val dstPort = u16(packet, ihl + 2)
    if (dstPort != 53) return null
    val udpLen = u16(packet, ihl + 4)
    if (udpLen < 8 + 12 || ihl + udpLen > totalLen) return null
    val payload = packet.copyOfRange(ihl + 8, ihl + udpLen)
    val flags = u16(payload, 2)
    val isQuery = (flags and 0x8000) == 0 && ((flags ushr 11) and 0xf) == 0
    return DnsQuery(
      qname = if (isQuery && u16(payload, 4) >= 1) readName(payload) else null,
      srcIp = packet.copyOfRange(12, 16),
      dstIp = packet.copyOfRange(16, 20),
      srcPort = srcPort,
      dstPort = dstPort,
      payload = payload
    )
  }

  /** Builds the IPv4/UDP reply that carries [dnsResponse] back to the querying app. */
  fun buildResponse(q: DnsQuery, dnsResponse: ByteArray): ByteArray {
    val total = 20 + 8 + dnsResponse.size
    val out = ByteArray(total)
    out[0] = 0x45
    put16(out, 2, total)
    out[8] = 64
    out[9] = 17
    q.dstIp.copyInto(out, 12)
    q.srcIp.copyInto(out, 16)
    put16(out, 10, checksum(out, 0, 20))
    put16(out, 20, q.dstPort)
    put16(out, 22, q.srcPort)
    put16(out, 24, 8 + dnsResponse.size)
    // UDP checksum 0 is valid for IPv4.
    dnsResponse.copyInto(out, 28)
    return out
  }

  fun checksum(b: ByteArray, off: Int, len: Int): Int {
    var sum = 0
    var i = off
    while (i + 1 < off + len) { sum += u16(b, i); i += 2 }
    while (sum ushr 16 != 0) sum = (sum and 0xffff) + (sum ushr 16)
    return sum.inv() and 0xffff
  }

  private fun readName(p: ByteArray): String? {
    var i = 12
    val sb = StringBuilder()
    while (true) {
      if (i >= p.size) return null
      val l = p[i].toInt() and 0xff
      if (l == 0) break
      if (l and 0xc0 != 0 || l > 63 || i + 1 + l > p.size) return null
      if (sb.isNotEmpty()) sb.append('.')
      for (k in 1..l) {
        val c = p[i + k].toInt() and 0xff
        if (c <= 0x20 || c >= 0x7f) return null
        sb.append(c.toChar())
      }
      i += 1 + l
      if (sb.length > 253) return null
    }
    return sb.toString().ifEmpty { null }
  }

  private fun u16(b: ByteArray, o: Int) = ((b[o].toInt() and 0xff) shl 8) or (b[o + 1].toInt() and 0xff)
  private fun put16(b: ByteArray, o: Int, v: Int) { b[o] = (v ushr 8).toByte(); b[o + 1] = v.toByte() }
}
