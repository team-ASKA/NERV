import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, BriefcaseIcon, AlertCircle, Code, Server, Database, Cloud, Smartphone, Palette, Eye, EyeOff, MapPin, GraduationCap, DollarSign, Linkedin, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

type SignUpFormData = {
  fullName: string;
  email: string;
  password: string;
  expertise: string[];
  experience: string;
  location: string;
  education: string;
  expectedSalary: string;
  linkedin: string;
  portfolio: string;
  skills: string;
};

const expertise = [
  { name: 'Frontend Development', icon: <Code className="h-4 w-4" /> },
  { name: 'Backend Development', icon: <Server className="h-4 w-4" /> },
  { name: 'Full Stack', icon: <Database className="h-4 w-4" /> },
  { name: 'DevOps', icon: <Cloud className="h-4 w-4" /> },
  { name: 'Mobile Development', icon: <Smartphone className="h-4 w-4" /> },
  { name: 'UI/UX Design', icon: <Palette className="h-4 w-4" /> },
];

const SignUp = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState(1); 

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    trigger,
  } = useForm<SignUpFormData>();

  const onSubmit = async (data: SignUpFormData) => {
    try {
      setError('');
      setLoading(true);
      
      // Create user account
      const userCredential = await signup(data.email, data.password);
      
      // Prepare user profile data
      const skillsArray = data.skills ? data.skills.split(',').map(skill => skill.trim()) : [];
      
      const userProfileData = {
        displayName: data.fullName,
        email: data.email,
        expertise: data.expertise || [],
        experience: data.experience || '',
        location: data.location || '',
        education: data.education || '',
        expectedSalary: data.expectedSalary || '',
        linkedin: data.linkedin || '',
        portfolio: data.portfolio || '',
        skills: skillsArray,
        photoURL: '',
        resumeURL: '',
        interviewsCompleted: 0,
        createdAt: new Date().toISOString(),
      };
      
      
      await setDoc(doc(db, 'users', userCredential.user.uid), userProfileData);
      
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Signup error:', err);
      
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already registered. Please use a different email or try logging in.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use a stronger password.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address. Please check and try again.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please check your internet connection and try again.');
      } else {
        setError('Failed to create an account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const nextStep = async () => {
    const fieldsToValidate = step === 1 
      ? ['fullName', 'email', 'password'] 
      : ['expertise'];
    
    const isValid = await trigger(fieldsToValidate as any);
    if (isValid) setStep(2);
  };

  const prevStep = () => {
    setStep(1);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 bg-black">
      <div className="max-w-4xl w-full">
        <div className="bg-black/80 p-6 rounded-xl shadow-2xl border border-white/10">
          <h2 className="text-2xl font-bold text-center mb-4">Create Account</h2>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-500">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <div>
                <p className="text-sm">{error}</p>
                {error.includes('already registered') && (
                  <Link to="/login" className="text-sm font-medium underline mt-1 block">
                    Go to login page
                  </Link>
                )}
              </div>
            </div>
          )}
          
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {step === 1 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('fullName', { required: 'Full name is required' })}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="John Doe"
                      />
                    </div>
                    {errors.fullName && (
                      <p className="mt-1 text-sm text-red-500">{errors.fullName.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('email', {
                          required: 'Email is required',
                          pattern: {
                            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                            message: 'Invalid email address',
                          },
                        })}
                        type="email"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="john@example.com"
                      />
                    </div>
                    {errors.email && (
                      <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('password', {
                          required: 'Password is required',
                          minLength: {
                            value: 6,
                            message: 'Password must be at least 6 characters',
                          },
                        })}
                        type={showPassword ? 'text' : 'password'}
                        className="w-full pl-10 pr-10 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={togglePasswordVisibility}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Experience Level</label>
                    <div className="relative">
                      <BriefcaseIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <select
                        {...register('experience')}
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors appearance-none"
                      >
                        <option value="">Select experience level</option>
                        <option value="0-1 years">0-1 years</option>
                        <option value="1-3 years">1-3 years</option>
                        <option value="3-5 years">3-5 years</option>
                        <option value="5-10 years">5-10 years</option>
                        <option value="10+ years">10+ years</option>
                      </select>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Location</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('location')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="New York, USA"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Education</label>
                    <div className="relative">
                      <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('education')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="B.S. Computer Science"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Skills (comma separated)</label>
                    <div className="relative">
                      <Code className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('skills')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="JavaScript, React, Node.js"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Expected Salary</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('expectedSalary')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="$80,000 - $100,000"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">LinkedIn Profile</label>
                    <div className="relative">
                      <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('linkedin')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="https://linkedin.com/in/username"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Portfolio Website</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        {...register('portfolio')}
                        type="text"
                        className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                        placeholder="https://yourportfolio.com"
                      />
                    </div>
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={nextStep}
                  className="w-full py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all font-semibold"
                >
                  Next: Technical Expertise
                </button>
              </>
            ) : (
              <>
                {/* Technical Expertise */}
                <div>
                  <label className="block text-sm font-medium mb-2">Technical Expertise</label>
                  <div className="bg-black/50 border border-white/20 p-4 rounded-lg">
                    <p className="text-sm text-gray-400 mb-3">Select all that apply to your skill set:</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {expertise.map((skill) => (
                        <label key={skill.name} className="flex items-center p-2 bg-black/70 border border-white/10 rounded-lg hover:border-white/30 transition-all cursor-pointer">
                          <input
                            type="checkbox"
                            value={skill.name}
                            {...register('expertise', {
                              required: 'Select at least one expertise',
                            })}
                            className="rounded-sm bg-transparent border-white/30 text-white focus:ring-white mr-2"
                          />
                          <div className="flex items-center">
                            <span className="text-white mr-1">{skill.icon}</span>
                            <span className="text-xs">{skill.name}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                    {errors.expertise && (
                      <p className="mt-2 text-sm text-red-500">{errors.expertise.message}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={prevStep}
                    className="py-2 bg-transparent border border-white/20 text-white rounded-lg hover:bg-white/10 transition-all font-medium flex-1"
                  >
                    Back
                  </button>
                  
                  <button
                    type="submit"
                    disabled={loading}
                    className="py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all font-semibold flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Creating Account...' : 'Create Account'}
                  </button>
                </div>
              </>
            )}
            
            <div className="text-center">
              <p className="text-sm text-gray-400">
                Already have an account?{' '}
                <Link to="/login" className="text-white hover:text-gray-300 underline transition-colors">
                  Login here
                </Link>
              </p>
            </div>

            <div className="mt-4 text-xs text-gray-500">
              <p className="font-medium mb-1">Having trouble signing up?</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Make sure you're using a unique email address</li>
                <li>Try disabling ad blockers or privacy extensions</li>
                <li>Check your internet connection</li>
                <li>If problems persist, please contact support</li>
              </ul>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SignUp;