import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import CustomerPicker from '../components/CustomerPicker'
import type { Customer } from '../components/CustomerPicker'

export default function JobSheetNew() {
  const { membership } = useAuth()
  const navigate = useNavigate()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [deviceBrand, setDeviceBrand] = useState('')
  const [deviceImei, setDeviceImei] = useState('')
  const [deviceColor, setDeviceColor] = useState('')
  const [devicePassword, setDevicePassword] = useState('')
  const [reportedProblem, setReportedProblem] = useState('')
  const [physicalCondition, setPhysicalCondition] = useState('')
  const [accessoriesReceived, setAccessoriesReceived] = useState('')
  const [estimatedReadyDate, setEstimatedReadyDate] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!membership) return
    setError(null)

    if (!customer) {
      setError('Select or add a customer before saving.')
      return
    }

    setSaving(true)

    const { data, error } = await supabase.rpc('create_job_sheet', {
      p_tenant_id: membership.tenantId,
      p_customer_id: customer.id,
      p_device_name: deviceName.trim() || null,
      p_device_brand: deviceBrand.trim() || null,
      p_device_imei: deviceImei.trim() || null,
      p_device_color: deviceColor.trim() || null,
      p_reported_problem: reportedProblem.trim() || null,
      p_physical_condition: physicalCondition.trim() || null,
      p_accessories_received: accessoriesReceived.trim() || null,
      p_estimated_ready_date: estimatedReadyDate || null,
      p_device_password: devicePassword.trim() || null,
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/job-sheets/${data.id}`)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">New Job Sheet</h1>
        <p className="mt-1 text-sm text-slate-400">Log a device intake. No billing here — that happens later.</p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Customer</h2>
          <CustomerPicker value={customer} onChange={setCustomer} />
        </section>

        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Device</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Brand</label>
                <input
                  type="text"
                  value={deviceBrand}
                  onChange={(e) => setDeviceBrand(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Device Name</label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">IMEI / Serial</label>
                <input
                  type="text"
                  value={deviceImei}
                  onChange={(e) => setDeviceImei(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Color</label>
                <input
                  type="text"
                  value={deviceColor}
                  onChange={(e) => setDeviceColor(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Device Password / PIN (optional)
              </label>
              <input
                type="text"
                value={devicePassword}
                onChange={(e) => setDevicePassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Intake Details</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Reported Problem</label>
              <textarea
                rows={2}
                value={reportedProblem}
                onChange={(e) => setReportedProblem(e.target.value)}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Physical Condition</label>
              <textarea
                rows={2}
                value={physicalCondition}
                onChange={(e) => setPhysicalCondition(e.target.value)}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Accessories Received
              </label>
              <textarea
                rows={2}
                value={accessoriesReceived}
                onChange={(e) => setAccessoriesReceived(e.target.value)}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Estimated Ready Date
              </label>
              <input
                type="date"
                value={estimatedReadyDate}
                onChange={(e) => setEstimatedReadyDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
        )}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="w-full rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create Job Sheet'}
        </button>
      </div>
    </div>
  )
}
