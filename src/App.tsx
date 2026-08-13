import { useState, useCallback } from 'react'
import Header from './components/Header'
import InputStep from './components/InputStep'
import AnalyzingStep from './components/AnalyzingStep'
import ResultsStep from './components/ResultsStep'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import { useAuth } from './context/AuthContext'
import { analyzeText, type AnalysisResult } from './lib/analyzer'

type Step = 'input' | 'analyzing' | 'results'
type AuthView = 'login' | 'register'

export default function App() {
  const { user, loading } = useAuth()
  const [authView, setAuthView] = useState<AuthView>('login')
  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const handleAnalyze = useCallback(() => {
    if (!text.trim()) return
    setStep('analyzing')
    setTimeout(() => {
      const res = analyzeText(text)
      setResult(res)
      setStep('results')
    }, 2600)
  }, [text])

  const handleReset = useCallback(() => {
    setStep('input')
    setResult(null)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white">
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        {authView === 'login' ? (
          <LoginForm onSwitchToRegister={() => setAuthView('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setAuthView('login')} />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header onReset={step !== 'input' ? handleReset : undefined} />

      <main className="mx-auto w-full">
        {step === 'input' && (
          <InputStep
            text={text}
            setText={setText}
            onAnalyze={handleAnalyze}
          />
        )}

        {step === 'analyzing' && <AnalyzingStep />}

        {step === 'results' && result && (
          <ResultsStep result={result} onReset={handleReset} />
        )}
      </main>

      <footer className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">
        ТЗ-Ассистент · Прототип · Эвристический анализ на клиенте
      </footer>
    </div>
  )
}
