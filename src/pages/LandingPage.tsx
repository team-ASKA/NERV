import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Mic, Brain, BarChart as ChartBar, CheckCircle, Users, Shield, Zap, BookOpen, Award } from 'lucide-react';
import { Link } from 'react-router-dom';

const features = [
  {
    icon: <Brain className="h-6 w-6" />,
    title: "AI-Powered Interviews",
    description: "Dynamic questions adapted to your responses in real-time"
  },
  {
    icon: <Mic className="h-6 w-6" />,
    title: "Speech Recognition",
    description: "Natural conversation flow with voice input support"
  },
  {
    icon: <ChartBar className="h-6 w-6" />,
    title: "Detailed Analytics",
    description: "Comprehensive feedback and performance insights"
  }
];

const benefits = [
  {
    icon: <CheckCircle className="h-6 w-6" />,
    title: "Reduce Interview Anxiety",
    description: "Practice in a stress-free environment to build confidence"
  },
  {
    icon: <Zap className="h-6 w-6" />,
    title: "Improve Response Quality",
    description: "Get instant feedback to refine your answers"
  },
  {
    icon: <BookOpen className="h-6 w-6" />,
    title: "Learn Industry Standards",
    description: "Understand what employers are looking for in candidates"
  },
  {
    icon: <Award className="h-6 w-6" />,
    title: "Track Your Progress",
    description: "See your improvement over time with detailed metrics"
  }
];

const testimonials = [
  {
    quote: "This platform transformed my interview preparation. I landed my dream job after just two weeks of practice!",
    author: "Sarah J., Software Engineer",
    company: "Hired at Google"
  },
  {
    quote: "The AI feedback helped me identify weaknesses in my responses that I never would have caught otherwise.",
    author: "Michael T., Product Manager",
    company: "Hired at Microsoft"
  },
  {
    quote: "As someone with interview anxiety, this tool was a game-changer. I felt so much more confident going into my interviews.",
    author: "Priya K., Data Scientist",
    company: "Hired at Amazon"
  }
];

// const pricingPlans = [
//   {
//     name: "Free",
//     price: "$0",
//     period: "forever",
//     features: [
//       "5 practice interviews per month",
//       "Basic feedback",
//       "Text-only interface"
//     ],
//     cta: "Get Started",
//     highlighted: false
//   },
//   {
//     name: "Pro",
//     price: "$19",
//     period: "per month",
//     features: [
//       "Unlimited practice interviews",
//       "Advanced AI feedback",
//       "Voice recognition",
//       "Performance analytics",
//       "Industry-specific questions"
//     ],
//     cta: "Try Pro",
//     highlighted: true
//   },
//   {
//     name: "Enterprise",
//     price: "Custom",
//     period: "pricing",
//     features: [
//       "Everything in Pro",
//       "Custom question sets",
//       "Team management",
//       "Branded experience",
//       "Priority support"
//     ],
//     cta: "Contact Us",
//     highlighted: false
//   }
// ];

const LandingPage = () => {
  return (
    <div className="relative">
      {/* Hero Section */}
      <section className="pt-40 pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="font-montserrat font-bold text-4xl sm:text-5xl md:text-6xl mb-8">
              Master Your Interviews with
              <span className="text-accent"> AI-Powered</span> Practice
            </h1>
            <p className="text-gray-400 text-lg sm:text-xl max-w-3xl mx-auto mb-12">
              Elevate your interview skills with real-time AI feedback, natural conversations, and comprehensive performance analysis. Practice makes perfect, and we make practice effortless.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <Link
                to="/signup"
                className="flex items-center px-10 py-4 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-semibold text-lg"
              >
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
              <Link
                to="/login"
                className="px-10 py-4 bg-secondary text-white rounded-lg hover:bg-secondary/80 transition-colors font-semibold text-lg"
              >
                Login
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-secondary/50">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-4">
              Powerful Features for Interview Success
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Our platform combines cutting-edge technology with practical interview techniques
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-10"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-secondary/80 backdrop-blur-sm hover:shadow-lg hover:shadow-accent/10 transition-all"
              >
                <div className="text-accent mb-6 p-3 bg-accent/10 inline-block rounded-lg">{feature.icon}</div>
                <h3 className="font-montserrat font-semibold text-2xl mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-400 text-lg">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-4">
              How It Works
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              A simple three-step process to transform your interview skills
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {[
              {
                step: "01",
                title: "Choose Your Interview Type",
                description: "Select from various interview types including technical, behavioral, or industry-specific scenarios."
              },
              {
                step: "02",
                title: "Practice with AI",
                description: "Engage in realistic interview simulations with our advanced AI interviewer that adapts to your responses."
              },
              {
                step: "03",
                title: "Review & Improve",
                description: "Get detailed feedback, suggestions for improvement, and track your progress over time."
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="relative p-8 rounded-xl border border-gray-700 hover:border-accent/50 transition-all"
              >
                <div className="absolute -top-5 -left-5 bg-accent text-white text-xl font-bold rounded-full w-10 h-10 flex items-center justify-center">
                  {item.step}
                </div>
                <h3 className="font-montserrat font-semibold text-xl mb-3 mt-4">
                  {item.title}
                </h3>
                <p className="text-gray-400">{item.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-secondary/30 to-transparent">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-4">
              Benefits That Make a Difference
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Our users experience real improvements in their interview performance
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 gap-8"
          >
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="flex items-start p-6 rounded-lg"
              >
                <div className="text-accent mr-4 mt-1">{benefit.icon}</div>
                <div>
                  <h3 className="font-montserrat font-semibold text-xl mb-2">
                    {benefit.title}
                  </h3>
                  <p className="text-gray-400">{benefit.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-4">
              Success Stories
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Hear from users who transformed their interview performance
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-secondary/30 backdrop-blur-sm relative"
              >
                <div className="text-4xl text-accent/20 absolute top-4 left-4">"</div>
                <p className="text-gray-300 mb-6 relative z-10 pt-6">"{testimonial.quote}"</p>
                <div className="border-t border-gray-700 pt-4">
                  <p className="font-semibold">{testimonial.author}</p>
                  <p className="text-accent text-sm">{testimonial.company}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center p-12 rounded-2xl bg-gradient-to-r from-accent/20 to-secondary/50 backdrop-blur-sm"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-6">
              Ready to Ace Your Next Interview?
            </h2>
            <p className="text-gray-300 text-lg max-w-2xl mx-auto mb-8">
              Join thousands of professionals who have transformed their interview skills with our platform.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center px-8 py-4 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-semibold text-lg"
            >
              Start Practicing Now
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;