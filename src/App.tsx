import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/invoices" replace />} />
              <Route path="/products" element={<Products />} />
              <Route path="/spare-parts" element={<SpareParts />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/new" element={<InvoiceNew />} />
              <Route path="/invoices/:id" element={<InvoiceDetail />} />
              <Route path="/invoices/:invoiceId/credit-notes/new" element={<CreditNoteNew />} />
              <Route path="/job-sheets" element={<JobSheets />} />
              <Route path="/job-sheets/new" element={<JobSheetNew />} />
              <Route path="/job-sheets/:id" element={<JobSheetDetail />} />
              <Route path="/quotations" element={<Quotations />} />
              <Route path="/quotations/new" element={<QuotationNew />} />
              <Route path="/quotations/:id" element={<QuotationDetail />} />
              <Route path="/credit-notes" element={<CreditNotes />} />
              <Route path="/credit-notes/:id" element={<CreditNoteDetail />} />
              <Route path="/vendors" element={<Vendors />} />
              <Route path="/vendor-purchases" element={<VendorPurchases />} />
              <Route path="/vendor-purchases/new" element={<VendorPurchaseNew />} />
              <Route path="/vendor-purchases/:id" element={<VendorPurchaseDetail />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
