import { NextResponse } from 'next/server'
import {
  getGlobalSummary,
  getVMBreakdown,
  getCMDBDriftSummary,
} from '@/lib/queries'

export async function GET() {
  try {
    const [summary, vms, cmdb] = await Promise.all([
      getGlobalSummary(),
      getVMBreakdown(),
      getCMDBDriftSummary(),
    ])
    return NextResponse.json({ summary, vms, cmdb })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
