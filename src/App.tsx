import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import RequirePermission from './components/RequirePermission'
import RequireAdmin from './components/RequireAdmin'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Products from './pages/Products'
import SpareParts from './pages/SpareParts'
import Invoices from './pages/Invoices'
import InvoiceNew from './pages/InvoiceNew'
import InvoiceDetail from './pages/InvoiceDetail'
import JobSheets from './pages/JobSheets'
import JobSheetNew from './pages/JobSheetNew'
import JobSheetDetail from './pages/JobSheetDetail'
import Quotations from './pages/Quotations'
import QuotationNew from './pages/QuotationNew'
import QuotationDetail from './pages/QuotationDetail'
import CreditNotes from './pages/CreditNotes'
import CreditNoteNew from './pages/CreditNoteNew'
import CreditNoteDetail from './pages/CreditNoteDetail'
import Vendors from './pages/Vendors'
import VendorPurchases from './pages/VendorPurchases'
import VendorPurchaseNew from './pages/VendorPurchaseNew'
import VendorPurchaseDetail from './pages/VendorPurchaseDetail'
import Finance from './pages/Finance'
import Team from './pages/Team'
import Account from './pages/Account'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/account" element={<Account />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />

              <Route element={<RequirePermission permission="invoicing" />}>
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/invoices/new" element={<InvoiceNew />} />
                <Route path="/invoices/:id" element={<InvoiceDetail />} />
                <Route path="/invoices/:invoiceId/credit-notes/new" element={<CreditNoteNew />} />
                <Route path="/quotations" element={<Quotations />} />
                <Route path="/quotations/new" element={<QuotationNew />} />
                <Route path="/quotations/:id" element={<QuotationDetail />} />
                <Route path="/credit-notes" element={<CreditNotes />} />
                <Route path="/credit-notes/:id" element={<CreditNoteDetail />} />
              </Route>

              <Route element={<RequirePermission permission="job_sheets" />}>
                <Route path="/job-sheets" element={<JobSheets />} />
                <Route path="/job-sheets/new" element={<JobSheetNew />} />
                <Route path="/job-sheets/:id" element={<JobSheetDetail />} />
              </Route>

              <Route element={<RequirePermission permission="inventory" />}>
                <Route path="/products" element={<Products />} />
                <Route path="/spare-parts" element={<SpareParts />} />
              </Route>

              <Route element={<RequirePermission permission="vendor_purchases" />}>
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/vendor-purchases" element={<VendorPurchases />} />
                <Route path="/vendor-purchases/new" element={<VendorPurchaseNew />} />
                <Route path="/vendor-purchases/:id" element={<VendorPurchaseDetail />} />
              </Route>

              <Route element={<RequirePermission permission="finance" />}>
                <Route path="/finance" element={<Finance />} />
              </Route>

              <Route element={<RequireAdmin />}>
                <Route path="/team" element={<Team />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
