module FixtureCRM
  class Application < Rails::Application
    config.load_defaults 8.0
    config.active_job.queue_adapter = :async
  end
end
