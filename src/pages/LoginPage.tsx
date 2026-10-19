import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import HyperfeedsLogo from '../components/ui/HyperfeedsLogo';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('operator');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    const isExactAdmin = cleanEmail === 'admin@hyperfeeds.com';
    const isOfficialDomain = cleanEmail.endsWith('@hyperfeeds.co.zw') || cleanEmail.endsWith('@hyperfeedsnutrition.co.zw');
    if (!isExactAdmin && !isOfficialDomain) {
      setError('Access restricted: Only official @hyperfeeds.co.zw email addresses or admin@hyperfeeds.com are allowed.');
      return;
    }

    setLoading(true);

    if (isLogin) {
      const { error: err } = await signIn(email, password);
      if (err) setError(err.message);
    } else {
      const { error: err } = await signUp(email, password, fullName, role);
      if (err) setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#080824] flex">
      {/* Left Hero Section */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#0a0b30]">
        <img
          src="https://images.pexels.com/photos/2255459/pexels-photo-2255459.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750"
          alt="Animal feed production"
          className="absolute inset-0 w-full h-full object-cover opacity-35 filter contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#06061c] via-[#0b0c36]/90 to-transparent" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <HyperfeedsLogo height={56} />
          </div>

          <div className="space-y-5 max-w-lg">
            <div className="inline-flex items-center rounded-full border border-orange-400/35 bg-orange-500/15 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-300">
              Hyper Plant Control System
            </div>
            <h1 className="text-[2rem] font-extrabold text-white tracking-tight leading-[1.15]">
              Precision Animal Nutrition & Feed Manufacturing
            </h1>
            <p className="text-slate-300/95 text-[15px] leading-relaxed font-medium">
              Enterprise-grade manufacturing lifecycle management — from raw material intake to automated micro-dosing, batching, QC, and multi-branch dispatch.
            </p>
          </div>

          <div className="text-xs text-slate-500 border-t border-white/10 pt-4 flex justify-between items-center">
            <span>Hyperfeeds Animal Nutrition © {new Date().getFullYear()}</span>
            <span className="text-orange-400/90 font-semibold tracking-wide">v2.4.7</span>
          </div>
        </div>
      </div>

      {/* Right Login Form Section */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-[#06061e]">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile Header Logo */}
          <div className="lg:hidden flex flex-col items-center gap-3 mb-4 text-center">
            <HyperfeedsLogo height={48} />
            <p className="text-[11px] text-orange-300 font-semibold uppercase tracking-[0.14em]">
              Hyper Plant Control System
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] p-8 border border-slate-100/90 relative overflow-hidden">
            {/* Top Corporate Accent Strip */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-orange-500 via-amber-500 to-[#0b0c36]" />

            <div className="mb-7 pt-1 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  {isLogin ? 'Sign In' : 'Create Account'}
                </h2>
                <p className="text-sm text-slate-500 font-medium mt-1.5 leading-snug">
                  {isLogin
                    ? 'Enter your credentials to access Plant Control'
                    : 'Register a new employee user account'}
                </p>
              </div>
              <div className="hidden sm:block shrink-0">
                <HyperfeedsLogo variant="compact" height={40} />
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                      placeholder="Enter your name"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">System Role / Designation</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white font-bold text-slate-800"
                      required
                    >
                      <option value="md">Managing Director (MD)</option>
                      <option value="production_manager">Production Manager</option>
                      <option value="warehouse_manager">Warehouse Manager</option>
                      <option value="logistics">Logistics Officer</option>
                      <option value="finance">Finance / Accountant</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="operator">Operator</option>
                      <option value="quality_controller">Quality Controller</option>
                      <option value="viewer">Viewer (Read Only)</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  placeholder="you@hyperfeedsnutrition.co.zw"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 pr-10"
                    placeholder="Enter password"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 mt-1 bg-gradient-to-r from-orange-500 via-amber-600 to-orange-600 hover:from-orange-600 hover:to-amber-700 text-white rounded-xl text-sm font-bold tracking-wide shadow-lg shadow-orange-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLogin ? 'Sign into Plant Control' : 'Create Account'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs font-medium text-slate-500">
              {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                onClick={() => { setIsLogin(!isLogin); setError(''); }}
                className="text-orange-600 hover:text-orange-700 font-extrabold underline underline-offset-2"
              >
                {isLogin ? 'Register User' : 'Sign In'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
