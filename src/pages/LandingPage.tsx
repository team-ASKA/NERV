import { motion } from 'framer-motion';
import { ArrowRight, Mic, Brain, BarChart as ChartBar, CheckCircle, Zap, BookOpen, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import SplineComponent from '../components/Spline';

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

const LandingPage = () => {
  return (
    <div className="relative">
      {/* Spline component as the main interactive element with responsive handling */}
      <div className="h-screen w-full overflow-hidden">
        <div className="scale-[1.30] md:block hidden">
          <SplineComponent />
        </div>
        <div className="md:hidden flex flex-col items-center justify-center h-full px-4 bg-black">
          <h1 className="font-montserrat font-bold text-4xl text-center mb-8">
            Master Your Interviews with
            <span className="text-green"> AI-Powered</span> Practice
          </h1>
          <div className="flex flex-col items-center gap-4 w-full">
            <Link
              to="/signup"
              className="flex items-center justify-center w-full px-10 py-4 bg-white text-black rounded-lg hover:bg-black hover:text-white transition-colors font-semibold text-lg"
            >
              Get Started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <Link
              to="/login"
              className="w-full text-center px-10 py-4 bg-secondary text-white rounded-lg hover:bg-white hover:text-black transition-colors font-semibold text-lg"
            >
              Login
            </Link>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-transparent relative z-10">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
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
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-10"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.2, ease: "easeOut" }}
                whileHover={{ y: -10, transition: { duration: 0.2 } }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all"
              >
                <div className="text-white mb-6 p-3 bg-white/10 inline-block rounded-lg">{feature.icon}</div>
                <h3 className="font-montserrat font-semibold text-2xl mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-400 text-lg">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-black/30 to-transparent">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
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
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 gap-8"
          >
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.15, ease: "easeOut" }}
                whileHover={{
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  transition: { duration: 0.2 }
                }}
                viewport={{ once: true }}
                className="flex items-start p-6 rounded-lg transition-colors"
              >
                <div className="text-white mr-4 mt-1">{benefit.icon}</div>
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

      {/* How it works — honest product description, no outcome claims. */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-4">How practice works</h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Upload a resume, check what was extracted, run three interview rounds, and get a saved
            report with quotes from your own answers. Then practise the weakest topic with a tutor.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            viewport={{ once: true }}
            className="text-center p-12 rounded-2xl bg-gradient-to-r from-white/10 to-black/50 backdrop-blur-sm border border-white/10"
          >
            <h2 className="font-montserrat font-bold text-3xl sm:text-4xl mb-6">
              Ready to Ace Your Next Interview?
            </h2>
            <p className="text-gray-300 text-lg max-w-2xl mx-auto mb-8">
              Free to try. Your resume stays yours — export or delete your data any time in Settings.
            </p>
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
            >
              <Link
                to="/signup"
                className="inline-flex items-center px-8 py-4 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all font-semibold text-lg"
              >
                Start Practicing Now
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;