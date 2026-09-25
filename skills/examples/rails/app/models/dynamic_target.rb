# The receiver depends on a runtime argument; no concrete model is established here.
class DynamicTarget
  def self.resolve(type)
    type.constantize
  end
end
